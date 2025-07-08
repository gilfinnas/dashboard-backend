const express = require("express");
const admin = require("firebase-admin");

// --- Firebase Admin SDK Initialization ---
try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log("Firebase Admin SDK initialized successfully.");
} catch (error) {
  console.error("CRITICAL ERROR: Could not initialize Firebase.", error);
  process.exit(1);
}

const db = admin.firestore();
const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;

// --- Middlewares ---
const corsMiddleware = (req, res, next) => {
  const allowedOrigins = [
    "https://dashboard-frontend-five-azure.vercel.app",
    "https://gilfinnas.com",
    "https://www.gilfinnas.com",
  ];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, x-api-key");
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
};

const authMiddleware = (req, res, next) => {
  if (!API_KEY) {
    console.warn("API_KEY is not set. Skipping authentication.");
    return next();
  }
  if (req.header("x-api-key") !== API_KEY) {
    return res.status(403).json({ error: "Forbidden: Invalid API key." });
  }
  next();
};

app.use(corsMiddleware);
app.use(authMiddleware);

// --- Data Processing Function (with Year Selection) ---
const getDashboardDataForUser = async (userId, selectedYear) => {
  console.log(`[1/5] Fetching data for userId: ${userId}, Year: ${selectedYear || 'latest'}`);
  const userDocRef = db.collection("users").doc(userId);
  const doc = await userDocRef.get();

  if (!doc.exists) {
    throw new Error(`User with ID '${userId}' not found.`);
  }

  console.log(`[2/5] Processing raw data...`);
  const userData = doc.data();
  const yearsData = userData.years || {};
  
  const availableYears = Object.keys(yearsData).sort((a, b) => b.localeCompare(a));
  const yearToProcess = selectedYear && yearsData[selectedYear] ? selectedYear : availableYears[0];

  if (!yearToProcess) {
      return { dashboardData: null, availableYears: [] };
  }

  const categoriesDefinition = {
      "הכנסות": { key: 'income', items: ["sales_cash", "sales_credit", "sales_cheques", "sales_transfer", "sales_other"]},
      "הכנסות פטורות ממע'מ": { key: 'income_exempt', items: ["exempt_sales_cash", "exempt_sales_credit", "exempt_sales_cheques", "exempt_sales_transfer", "exempt_sales_other"]},
      "ספקים": { key: 'suppliers', items: ["supplier_1", "supplier_2", "supplier_3", "supplier_4", "supplier_5", "supplier_6", "supplier_7", "supplier_8", "supplier_9", "supplier_10"]},
      "הוצאות משתנות": { key: 'variable_expenses', items: ["electricity", "water", "packaging", "marketing", "custom_var_1", "custom_var_2", "custom_var_3", "custom_var_4", "car_expenses", "phone_expenses", "partial_custom_1", "partial_custom_2"]},
      "הלוואות": { key: 'loans', items: ["loan_1", "loan_2", "loan_3", "loan_4", "loan_5", "loan_6", "loan_7", "loan_8", "loan_9", "loan_10"]},
      "הוצאות קבועות": { key: 'fixed_expenses', items: ["rent", "arnona", "insurance", "accounting", "communication", "software", "custom_fixed_1", "custom_fixed_2", "custom_fixed_3", "custom_fixed_4"]},
      "משכורות ותשלומים": { key: 'salaries_and_taxes', items: ["salaries", "social_security", "income_tax", "vat_payment", "vat_field", "custom_tax_1", "custom_tax_2", "custom_tax_3", "custom_tax_4"]},
      "בלת'מ": { key: 'misc', items: ["misc"]}
  };
  
  const allIncomeKeys = [...categoriesDefinition["הכנסות"].items, ...categoriesDefinition["הכנסות פטורות ממע'מ"].items];
  const monthNames = ["ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳"];
  const groupMapping = {
      'ספקים': categoriesDefinition.ספקים.items,
      'הוצאות קבועות': categoriesDefinition['הוצאות קבועות'].items,
      'הוצאות משתנות': categoriesDefinition['הוצאות משתנות'].items,
      'משכורות ומיסים': categoriesDefinition['משכורות ותשלומים'].items,
      'הלוואות': categoriesDefinition.הלוואות.items,
      "בלת'מ": categoriesDefinition["בלת'מ"].items,
  };

  const yearMonthsData = [];
  const yearData = yearsData[yearToProcess] || {};

  for (const monthIndex in yearData) {
      const categoriesData = yearData[monthIndex]?.categories || {};
      
      let monthTotalIncome = 0;
      allIncomeKeys.forEach(catKey => {
          monthTotalIncome += (categoriesData[catKey] || []).reduce((s, v) => s + (Number(v) || 0), 0);
      });

      const expenseBreakdown = {};
      let monthTotalExpense = 0;
      Object.entries(groupMapping).forEach(([groupName, catKeys]) => {
          const groupSum = catKeys.reduce((sum, key) => sum + (categoriesData[key] || []).reduce((s, v) => s + (Number(v) || 0), 0), 0);
          expenseBreakdown[groupName] = groupSum;
          monthTotalExpense += groupSum;
      });
      
      yearMonthsData.push({
          month: parseInt(monthIndex),
          name: `${monthNames[monthIndex]}`,
          income: monthTotalIncome,
          expense: monthTotalExpense,
          expenseBreakdown: expenseBreakdown
      });
  }

  yearMonthsData.sort((a, b) => a.month - b.month);
  console.log(`[3/5] Sorted ${yearMonthsData.length} months of data for year ${yearToProcess}.`);
  
  const finalData = {
    kpi: { ytdNetProfit: 0, monthlySalaries: 0, monthlyLoans: 0, monthlySuppliers: 0 },
    charts: { monthlyComparison: [], monthlyExpenseComposition: [], expenseTrend: [] }
  };

  if (yearMonthsData.length === 0) {
      return { dashboardData: finalData, availableYears };
  }
  
  let totalYearlyNetProfit = 0;
  let totalYearlyExpensesBreakdown = {};
  Object.keys(groupMapping).forEach(group => totalYearlyExpensesBreakdown[group] = 0);

  yearMonthsData.forEach(data => {
      totalYearlyNetProfit += data.income - data.expense;
      for(const group in data.expenseBreakdown) {
          totalYearlyExpensesBreakdown[group] += data.expenseBreakdown[group];
      }
  });

  finalData.kpi.ytdNetProfit = Math.round(totalYearlyNetProfit);
  
  const monthsWithData = yearMonthsData.length;
  finalData.kpi.monthlySalaries = Math.round((totalYearlyExpensesBreakdown['משכורות ומיסים'] || 0) / monthsWithData);
  finalData.kpi.monthlyLoans = Math.round((totalYearlyExpensesBreakdown['הלוואות'] || 0) / monthsWithData);
  finalData.kpi.monthlySuppliers = Math.round((totalYearlyExpensesBreakdown['ספקים'] || 0) / monthsWithData);
  console.log(`[4/5] Calculated KPIs for the year.`);

  const categoryColors = { "ספקים": "#3b82f6", "הוצאות קבועות": "#8b5cf6", "הוצאות משתנות": "#ef4444", "משכורות ומיסים": "#f97316", "הלוואות": "#14b8a6", "בלת'מ": "#64748b" };
  finalData.charts.monthlyExpenseComposition = Object.entries(totalYearlyExpensesBreakdown)
    .filter(([, value]) => value > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([name, value]) => ({ name, value, color: categoryColors[name] || "#6b7280" }));

  const fullYearComparison = monthNames.map((name, index) => {
      const monthData = yearMonthsData.find(d => d.month === index);
      return {
          name: name,
          הכנסות: monthData?.income || 0,
          הוצאות: monthData?.expense || 0,
      };
  });
  finalData.charts.monthlyComparison = fullYearComparison;
  
  finalData.charts.expenseTrend = fullYearComparison.map((month, index) => {
      const monthData = yearMonthsData.find(d => d.month === index);
      const trendData = { name: month.name };
      Object.keys(groupMapping).forEach(group => {
          trendData[group] = monthData?.expenseBreakdown[group] || 0;
      });
      return trendData;
  });
  
  console.log(`[5/5] Formatted chart data. Sending response.`);
  return { dashboardData: finalData, availableYears };
};

// --- API Route ---
app.get("/api/dashboard/:userId", async (req, res) => {
  const { userId } = req.params;
  const { year } = req.query;
  try {
    const data = await getDashboardDataForUser(userId, year);
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
