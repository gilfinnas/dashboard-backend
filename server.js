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
  const allExpenseKeys = Object.values(categoriesDefinition)
      .filter(group => !group.key.includes('income'))
      .flatMap(group => group.items);

  const allMonthsData = [];

  const monthNames = ["ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳"];
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear().toString();

  for (const year in yearsData) {
    for (const monthIndex in yearsData[year]) {
      const monthData = yearsData[year][monthIndex];
      const categoriesData = monthData.categories || {};
      
      let monthTotalIncome = 0;
      let monthTotalExpense = 0;
      const expenseBreakdown = { 'ספקים': 0, 'הוצאות קבועות': 0, 'הוצאות משתנות': 0, 'משכורות ומיסים': 0, 'הלוואות': 0, "בלת'מ": 0 };

      // Calculate Total Income
      allIncomeKeys.forEach(catKey => {
          monthTotalIncome += (categoriesData[catKey] || []).reduce((s, v) => s + (Number(v) || 0), 0);
      });

      // Calculate Expense Breakdown
      const groupMapping = {
          'ספקים': categoriesDefinition.ספקים.items,
          'הוצאות קבועות': categoriesDefinition['הוצאות קבועות'].items,
          'הוצאות משתנות': categoriesDefinition['הוצאות משתנות'].items,
          'משכורות ומיסים': categoriesDefinition['משכורות ותשלומים'].items,
          'הלוואות': categoriesDefinition.הלוואות.items,
          "בלת'מ": categoriesDefinition["בלת'מ"].items,
      };
      
      Object.entries(groupMapping).forEach(([groupName, catKeys]) => {
          let groupSum = 0;
          catKeys.forEach(catKey => {
              groupSum += (categoriesData[catKey] || []).reduce((s, v) => s + (Number(v) || 0), 0);
          });
          expenseBreakdown[groupName] = groupSum;
          monthTotalExpense += groupSum;
      });
      
      allMonthsData.push({
          year: parseInt(year),
          month: parseInt(monthIndex),
          name: `${monthNames[monthIndex]} ${year}`,
          income: monthTotalIncome,
          expense: monthTotalExpense,
          expenseBreakdown: expenseBreakdown
      });
    }
  }

  // Sort all months chronologically
  allMonthsData.sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
  });

  const last6MonthsData = allMonthsData.slice(-6);

  // YTD & Current Month Metrics
  let ytdNetProfit = 0;
  let currentMonthSalaries = 0;
  let currentMonthLoans = 0;
  let currentMonthSuppliers = 0;
  let monthlyExpenseComposition = {};

  // Calculate YTD from all available data for the current year
  allMonthsData.forEach(data => {
      if (data.year === parseInt(currentYear)) {
          ytdNetProfit += data.income - data.expense;
      }
  });
  
  // Get current month's data for KPIs
  const currentMonthData = allMonthsData.find(d => d.year === parseInt(currentYear) && d.month === currentMonth);
  if (currentMonthData) {
      currentMonthSalaries = currentMonthData.expenseBreakdown['משכורות ומיסים'];
      currentMonthLoans = currentMonthData.expenseBreakdown['הלוואות'];
      currentMonthSuppliers = currentMonthData.expenseBreakdown['ספקים'];
      
      // For composition chart
      Object.entries(currentMonthData.expenseBreakdown).forEach(([name, value]) => {
          if (value > 0) monthlyExpenseComposition[name] = value;
      });
  }
  
  // Format data for charts using the last 6 months
  const monthlyComparisonData = last6MonthsData.map(d => ({
    name: d.name,
    הכנסות: d.income,
    הוצאות: d.expense,
  }));
  
  const expenseTrendData = last6MonthsData.map(d => ({
      name: d.name,
      ...d.expenseBreakdown
  }));

  const categoryColors = { "ספקים": "#3b82f6", "הוצאות קבועות": "#8b5cf6", "הוצאות משתנות": "#ef4444", "משכורות ומיסים": "#f97316", "הלוואות": "#14b8a6", "בלת'מ": "#64748b" };
  const expenseCompositionData = Object.entries(monthlyExpenseComposition)
    .sort(([, a], [, b]) => b - a)
    .map(([name, value]) => ({
      name,
      value,
      color: categoryColors[name] || "#6b7280"
  }));
  
  return {
    kpi: {
        ytdNetProfit: Math.round(ytdNetProfit),
        monthlySalaries: Math.round(currentMonthSalaries),
        monthlyLoans: Math.round(currentMonthLoans),
        monthlySuppliers: Math.round(currentMonthSuppliers),
    },
    charts: {
        monthlyComparison: monthlyComparisonData,
        monthlyExpenseComposition: expenseCompositionData,
        expenseTrend: expenseTrendData,
    }
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
