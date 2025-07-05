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

  const allMonthsData = [];
  const monthNames = ["ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳"];

  for (const year in yearsData) {
    for (const monthIndex in yearsData[year]) {
      const monthData = yearsData[year][monthIndex];
      const categoriesData = monthData.categories || {};
      
      let monthTotalIncome = 0;
      let monthTotalExpense = 0;
      const expenseBreakdown = { 'ספקים': 0, 'הוצאות קבועות': 0, 'הוצאות משתנות': 0, 'משכורות ומיסים': 0, 'הלוואות': 0, "בלת'מ": 0 };

      allIncomeKeys.forEach(catKey => {
          monthTotalIncome += (categoriesData[catKey] || []).reduce((s, v) => s + (Number(v) || 0), 0);
      });

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

  // --- START OF FIX: Handle case with no data gracefully ---
  if (allMonthsData.length === 0) {
      console.log(`No data found for user ${userId}. Returning default empty structure.`);
      return {
          kpi: { ytdNetProfit: 0, monthlySalaries: 0, monthlyLoans: 0, monthlySuppliers: 0 },
          charts: { monthlyComparison: [], monthlyExpenseComposition: [], expenseTrend: [] }
      };
  }
  // --- END OF FIX ---

  const last6MonthsData = allMonthsData.slice(-6);

  let ytdNetProfit = 0;
  let currentMonthSalaries = 0;
  let currentMonthLoans = 0;
  let currentMonthSuppliers = 0;
  let monthlyExpenseComposition = {};

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthIndex = now.getMonth();

  allMonthsData.forEach(data => {
      if (data.year === currentYear) {
          ytdNetProfit += data.income - data.expense;
      }
  });
  
  const currentMonthData = allMonthsData.find(d => d.year === currentYear && d.month === currentMonthIndex);
  
  if (currentMonthData && currentMonthData.expenseBreakdown) {
      currentMonthSalaries = currentMonthData.expenseBreakdown['משכורות ומיסים'] || 0;
      currentMonthLoans = currentMonthData.expenseBreakdown['הלוואות'] || 0;
      currentMonthSuppliers = currentMonthData.expenseBreakdown['ספקים'] || 0;
      
      Object.entries(currentMonthData.expenseBreakdown).forEach(([name, value]) => {
          if (value > 0) monthlyExpenseComposition[name] = value;
      });
  }
  
  const monthlyComparisonData = last6MonthsData.map(d => ({
    name: d.name,
    הכנסות: d.income || 0,
    הוצאות: d.expense || 0,
  }));
  
  const expenseTrendData = last6MonthsData.map(d => ({
      name: d.name,
      'ספקים': d.expenseBreakdown['ספקים'] || 0,
      'הוצאות קבועות': d.expenseBreakdown['הוצאות קבועות'] || 0,
      'הוצאות משתנות': d.expenseBreakdown['הוצאות משתנות'] || 0,
      'משכורות ומיסים': d.expenseBreakdown['משכורות ומיסים'] || 0,
      'הלוואות': d.expenseBreakdown['הלוואות'] || 0,
      "בלת'מ": d.expenseBreakdown["בלת'מ"] || 0,
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
