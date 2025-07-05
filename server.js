const express = require("express");
const admin = require("firebase-admin");

// --- Firebase Admin SDK Initialization ---
try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log("Firebase Admin SDK initialized successfully for project:", serviceAccount.project_id);
} catch (error) {
  console.error("CRITICAL ERROR: Could not initialize Firebase service account.", error);
  process.exit(1);
}

const db = admin.firestore();
const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;

// --- CORS Middleware ---
const allowedOrigins = [
  "https://dashboard-frontend-five-azure.vercel.app",
  "https://gilfinnas.com",
  "https://www.gilfinnas.com",
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, x-api-key");
  next();
});

// --- API Key Authentication Middleware ---
const authenticateApiKey = (req, res, next) => {
  const receivedApiKey = req.header("x-api-key");
  if (!API_KEY) {
    console.warn("SECURITY WARNING: API_KEY is not set. Skipping authentication.");
    return next();
  }
  if (!receivedApiKey || receivedApiKey !== API_KEY) {
    console.error(`Forbidden: Invalid API key received.`);
    return res.status(403).json({ error: "Forbidden: Invalid API key." });
  }
  next();
};

// --- Data Processing Function ---
const getDashboardDataForUser = async (userId) => {
  console.log(`Fetching data for userId: ${userId}`);
  const userDocRef = db.collection("users").doc(userId);
  const doc = await userDocRef.get();

  if (!doc.exists) {
    throw new Error(`User with ID '${userId}' not found.`);
  }

  console.log(`Processing data for user: ${userId}`);
  const userData = doc.data();
  const yearsData = userData.years || {};

  const categoriesDefinition = {
      "הכנסות": ["sales_cash", "sales_credit", "sales_cheques", "sales_transfer", "sales_other"],
      "הכנסות פטורות ממע'מ": ["exempt_sales_cash", "exempt_sales_credit", "exempt_sales_cheques", "exempt_sales_transfer", "exempt_sales_other"],
      "ספקים": ["supplier_1", "supplier_2", "supplier_3", "supplier_4", "supplier_5", "supplier_6", "supplier_7", "supplier_8", "supplier_9", "supplier_10"],
      "הוצאות משתנות": ["electricity", "water", "packaging", "marketing", "custom_var_1", "custom_var_2", "custom_var_3", "custom_var_4"],
      "הוצאות עם הכרה חלקית במע'מ": ["car_expenses", "phone_expenses", "partial_custom_1", "partial_custom_2"],
      "הלוואות": ["loan_1", "loan_2", "loan_3", "loan_4", "loan_5", "loan_6", "loan_7", "loan_8", "loan_9", "loan_10"],
      "הוצאות קבועות": ["rent", "arnona", "salaries", "insurance", "accounting", "communication", "software", "custom_fixed_1", "custom_fixed_2", "custom_fixed_3", "custom_fixed_4"],
      "תשלומים ומיסים": ["social_security", "income_tax", "vat_payment", "vat_field", "custom_tax_1", "custom_tax_2", "custom_tax_3", "custom_tax_4"],
      "הוצאות בלתי צפויות": ["misc"]
  };

  const allIncomeKeys = [...categoriesDefinition["הכנסות"], ...categoriesDefinition["הכנסות פטורות ממע'מ"]];
  const allExpenseKeys = Object.entries(categoriesDefinition)
      .filter(([key]) => key !== "הכנסות" && key !== "הכנסות פטורות ממע'מ")
      .flatMap(([, keys]) => keys);

  const monthlyBreakdown = {};
  const expenseByCategory = {};
  const recentTransactions = [];
  let incomeTransactionCount = 0;
  let expenseTransactionCount = 0;

  const monthNames = ["ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳"];
  const currentYear = new Date().getFullYear().toString();

  for (const year in yearsData) {
    for (const monthIndex in yearsData[year]) {
      const monthData = yearsData[year][monthIndex];
      const categoriesData = monthData.categories || {};
      const customNames = monthData.customNames || {};
      const monthKey = `${monthNames[monthIndex]} ${year}`;
      if (!monthlyBreakdown[monthKey]) {
        monthlyBreakdown[monthKey] = { income: 0, expense: 0 };
      }

      let monthIncome = 0, monthExpense = 0;

      allIncomeKeys.forEach(catKey => {
        const dailyValues = categoriesData[catKey] || [];
        dailyValues.forEach((value, day) => {
          const numValue = Number(value) || 0;
          if (numValue > 0) {
            monthIncome += numValue;
            incomeTransactionCount++;
            recentTransactions.push({
              id: `${year}-${monthIndex}-${day}-${catKey}-in`,
              description: customNames[catKey] || catKey.replace(/_/g, " "),
              amount: numValue,
              type: "inflow",
              date: new Date(year, monthIndex, day + 1)
            });
          }
        });
      });

      Object.entries(categoriesDefinition).forEach(([groupName, keys]) => {
        if (allIncomeKeys.includes(keys[0])) return;
        let groupSum = 0;
        keys.forEach(catKey => {
          const dailyValues = categoriesData[catKey] || [];
          dailyValues.forEach((value, day) => {
            const numValue = Number(value) || 0;
            if (numValue > 0) {
              groupSum += numValue;
              expenseTransactionCount++;
              recentTransactions.push({
                id: `${year}-${monthIndex}-${day}-${catKey}-out`,
                description: customNames[catKey] || catKey.replace(/_/g, " "),
                amount: numValue,
                type: "outflow",
                date: new Date(year, monthIndex, day + 1)
              });
            }
          });
        });
        if (groupSum > 0) {
          monthExpense += groupSum;
          if(year === currentYear) {
            expenseByCategory[groupName] = (expenseByCategory[groupName] || 0) + groupSum;
          }
        }
      });
      
      monthlyBreakdown[monthKey].income += monthIncome;
      monthlyBreakdown[monthKey].expense += monthExpense;
    }
  }

  // YTD Metrics
  let ytdIncome = 0;
  let ytdExpense = 0;
  if (yearsData[currentYear]) {
      Object.values(yearsData[currentYear]).forEach(monthData => {
          const categoriesData = monthData.categories || {};
          allIncomeKeys.forEach(key => ytdIncome += (categoriesData[key] || []).reduce((s, v) => s + (Number(v) || 0), 0));
          allExpenseKeys.forEach(key => ytdExpense += (categoriesData[key] || []).reduce((s, v) => s + (Number(v) || 0), 0));
      });
  }
  const ytdNetProfit = ytdIncome - ytdExpense;
  
  // Format data for charts
  const sortedMonths = Object.keys(monthlyBreakdown).sort((a, b) => {
      const [m1, y1] = a.split(' ');
      const [m2, y2] = b.split(' ');
      return new Date(`${y1}-${monthNames.indexOf(m1)+1}-01`) - new Date(`${y2}-${monthNames.indexOf(m2)+1}-01`);
  });

  const monthlyComparisonData = sortedMonths.slice(-6).map(name => ({
    name,
    הכנסות: monthlyBreakdown[name].income,
    הוצאות: monthlyBreakdown[name].expense,
  }));

  let cumulativeProfit = 0;
  const netProfitTrendData = sortedMonths.slice(-6).map(name => {
      const net = monthlyBreakdown[name].income - monthlyBreakdown[name].expense;
      cumulativeProfit += net;
      return { name, "רווח נקי": net, "רווח מצטבר": cumulativeProfit };
  });

  const categoryColors = ["#3b82f6", "#8b5cf6", "#10b981", "#f97316", "#ef4444", "#6366f1", "#f59e0b", "#14b8a6"];
  const expenseByCategoryData = Object.entries(expenseByCategory)
    .sort(([, a], [, b]) => b - a)
    .map(([name, value], index) => ({
      name,
      value,
      color: categoryColors[index % categoryColors.length]
  }));

  const sortedTransactions = recentTransactions.sort((a, b) => b.date - a.date).slice(0, 7);

  return {
    kpi: {
        ytdNetProfit: Math.round(ytdNetProfit),
        ytdIncome: Math.round(ytdIncome),
        ytdExpense: Math.round(ytdExpense),
        totalTransactions: incomeTransactionCount + expenseTransactionCount,
    },
    charts: {
        monthlyComparison: monthlyComparisonData.length > 0 ? monthlyComparisonData : [{ name: "אין נתונים", הכנסות: 0, הוצאות: 0 }],
        expenseComposition: expenseByCategoryData.length > 0 ? expenseByCategoryData : [{ name: "אין נתונים", value: 1, color: "#6b7280" }],
        netProfitTrend: netProfitTrendData.length > 0 ? netProfitTrendData : [{ name: "אין נתונים", "רווח נקי": 0, "רווח מצטבר": 0 }],
    },
    recentTransactions: sortedTransactions,
  };
};

// --- API Route ---
app.get("/api/dashboard/:userId", authenticateApiKey, async (req, res) => {
  const { userId } = req.params;
  try {
    const data = await getDashboardDataForUser(userId);
    res.json(data);
  } catch (error) {
    console.error(`API Error for userId ${userId}:`, error.message);
    res.status(error.message.includes("not found") ? 404 : 500).json({ error: error.message });
  }
});

// --- Server Start ---
app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
