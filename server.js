const express = require("express");
const admin = require("firebase-admin");

// --- Firebase Admin SDK Initialization ---
try {
  // Ensure the environment variable is parsed correctly
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
  // If API_KEY is not set in environment, skip auth for local development
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

  // --- START: Define categories for server-side logic ---
  // A simplified version of the frontend categories object
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
  // --- END: Define categories ---


  let totalIncome = 0;
  let totalExpense = 0;
  const monthlyBreakdown = {}; // e.g., { "יולי 2025": { income: 5000, expense: 3000 } }
  const expenseByCategory = {}; // e.g., { "הוצאות קבועות": 1500, "ספקים": 1200 }
  const recentTransactions = [];

  const monthNames = ["ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳"];
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  // Aggregate data from all years and months
  for (const year in yearsData) {
    for (const monthIndex in yearsData[year]) {
      const monthData = yearsData[year][monthIndex];
      const categoriesData = monthData.categories || {};
      const customNames = monthData.customNames || {};

      const monthKey = `${monthNames[monthIndex]} ${year}`;
      if (!monthlyBreakdown[monthKey]) {
        monthlyBreakdown[monthKey] = { income: 0, expense: 0 };
      }

      let monthlyIncome = 0;
      let monthlyExpense = 0;

      // Calculate total income for the month
      allIncomeKeys.forEach(catKey => {
        const dailyValues = categoriesData[catKey] || [];
        const categorySum = dailyValues.reduce((sum, value) => sum + (Number(value) || 0), 0);
        if (categorySum > 0) {
          monthlyIncome += categorySum;
          // Add to recent transactions
          dailyValues.forEach((value, day) => {
            if (Number(value) > 0) {
              recentTransactions.push({
                id: `${year}-${monthIndex}-${day}-${catKey}`,
                description: customNames[catKey] || catKey.replace(/_/g, " "),
                amount: Number(value),
                type: "inflow",
                date: new Date(year, monthIndex, day + 1)
              });
            }
          });
        }
      });

      // Calculate total expense for the month and by category
      Object.entries(categoriesDefinition).forEach(([groupName, keys]) => {
          if (groupName !== "הכנסות" && groupName !== "הכנסות פטורות ממע'מ") {
              let groupSum = 0;
              keys.forEach(catKey => {
                  const dailyValues = categoriesData[catKey] || [];
                  const categorySum = dailyValues.reduce((sum, value) => sum + (Number(value) || 0), 0);
                  if (categorySum > 0) {
                      groupSum += categorySum;
                      // Add to recent transactions
                      dailyValues.forEach((value, day) => {
                          if (Number(value) > 0) {
                              recentTransactions.push({
                                  id: `${year}-${monthIndex}-${day}-${catKey}`,
                                  description: customNames[catKey] || catKey.replace(/_/g, " "),
                                  amount: Number(value),
                                  type: "outflow",
                                  date: new Date(year, monthIndex, day + 1)
                              });
                          }
                      });
                  }
              });
              if(groupSum > 0){
                 monthlyExpense += groupSum;
                 expenseByCategory[groupName] = (expenseByCategory[groupName] || 0) + groupSum;
              }
          }
      });
      
      monthlyBreakdown[monthKey].income += monthlyIncome;
      monthlyBreakdown[monthKey].expense += monthlyExpense;
    }
  }

  // Get current month's totals for KPI cards
  const currentMonthKey = `${monthNames[currentMonth]} ${currentYear}`;
  const currentMonthIncome = monthlyBreakdown[currentMonthKey]?.income || 0;
  const currentMonthExpense = monthlyBreakdown[currentMonthKey]?.expense || 0;
  
  // --- Format data for Recharts ---
  const monthlyComparisonData = Object.entries(monthlyBreakdown).map(([name, values]) => ({
    name,
    הכנסות: values.income,
    הוצאות: values.expense,
  })).slice(-6); // Get last 6 months for the chart

  const categoryColors = ["#3b82f6", "#8b5cf6", "#10b981", "#f97316", "#ef4444", "#6366f1", "#f59e0b"];
  const expenseByCategoryData = Object.entries(expenseByCategory)
    .sort(([, a], [, b]) => b - a) // Sort by value descending
    .map(([name, value], index) => ({
      name,
      value,
      color: categoryColors[index % categoryColors.length]
  }));

  // Sort recent transactions by date and take the last 5
  const sortedTransactions = recentTransactions
    .sort((a, b) => b.date - a.date)
    .slice(0, 5);

  console.log(`Processing complete. Current Month Income: ${currentMonthIncome}, Expense: ${currentMonthExpense}`);

  return {
    mainMetrics: {
      currentMonthIncome: Math.round(currentMonthIncome),
      currentMonthExpense: Math.round(currentMonthExpense),
      currentMonthBalance: Math.round(currentMonthIncome - currentMonthExpense),
      // Placeholders for change metrics
      incomeChange: 12.5,
      expenseChange: -5.2,
      balanceChange: 20.1,
    },
    monthlyComparisonData: monthlyComparisonData.length > 0 ? monthlyComparisonData : [{ name: "אין נתונים", הכנסות: 0, הוצאות: 0 }],
    expenseByCategoryData: expenseByCategoryData.length > 0 ? expenseByCategoryData : [{ name: "אין נתונים", value: 1, color: "#6b7280" }],
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
