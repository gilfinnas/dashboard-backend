const express = require("express");
const admin = require("firebase-admin");

// --- Firebase Admin SDK Initialization ---
try {
  // It's recommended to use environment variables for service account keys
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log("Firebase Admin SDK initialized successfully for project:", serviceAccount.project_id);
} catch (error) {
  console.error("CRITICAL ERROR: Could not initialize Firebase service account.", error);
  // In a real production environment, you might want to exit if Firebase doesn't connect
  process.exit(1);
}

const db = admin.firestore();
const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;

// --- CORS Middleware ---
// Define the list of allowed origins for security
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
  // If API_KEY is not set in the environment, this check is skipped.
  // For production, ensure API_KEY is always set.
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

// --- Data Processing Function (Now with year selection) ---
// The function now accepts an optional 'selectedYear' parameter
const getDashboardDataForUser = async (userId, selectedYear) => {
  console.log(`Fetching data for userId: ${userId}, requested year: ${selectedYear || 'latest'}`);
  const userDocRef = db.collection("users").doc(userId);
  const doc = await userDocRef.get();

  if (!doc.exists) {
    throw new Error(`User with ID '${userId}' not found.`);
  }

  const userData = doc.data();
  const yearsData = userData.years || {};
  
  // Get a sorted list of available years (e.g., ["2026", "2025"])
  const availableYears = Object.keys(yearsData).sort((a, b) => b.localeCompare(a));

  if (availableYears.length === 0) {
      // Handle case where there is no data at all for any year
      return {
          dashboardData: {
              mainMetrics: { totalRevenue: 0, revenueChange: 0, activeUsers: 0, usersChange: 0, avgMonthlyRevenue: 0, avgChange: 0 },
              monthlyRevenueData: [],
              revenueByCategoryData: [],
              recentTransactions: [],
          },
          availableYears: []
      };
  }

  // Determine which year to process. Default to the latest available year if none is selected or the selected one is invalid.
  const yearToProcess = selectedYear && yearsData[selectedYear] ? selectedYear : availableYears[0];
  console.log(`Processing data for year: ${yearToProcess}`);

  const yearData = yearsData[yearToProcess];

  let totalRevenue = 0;
  const monthlyRevenue = {}; // e.g., "יולי": 12000
  const revenueByCategory = {}; // e.g., "מכירות (אשראי)": 5000
  const recentTransactions = [];
  let transactionCount = 0;

  const monthNames = ["ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳"];

  // Loop through the months of the selected year
  for (const monthIndex in yearData) {
    const monthData = yearData[monthIndex];
    if (!monthData) continue;

    const categories = monthData.categories || {};
    const customNames = monthData.customNames || {};
    
    const monthKey = monthNames[monthIndex];
    monthlyRevenue[monthKey] = 0;

    for (const catKey in categories) {
      // We consider "income" type categories as revenue
      if (catKey.includes("sales") || catKey.includes("exempt")) {
        const dailyValues = categories[catKey] || [];
        const categorySum = dailyValues.reduce((sum, value) => sum + (Number(value) || 0), 0);

        if (categorySum > 0) {
          totalRevenue += categorySum;
          monthlyRevenue[monthKey] += categorySum;

          const categoryName = customNames[catKey] || catKey.replace(/_/g, " ");
          revenueByCategory[categoryName] = (revenueByCategory[categoryName] || 0) + categorySum;
          
          dailyValues.forEach((value, day) => {
              if (Number(value) > 0) {
                  transactionCount++;
                  recentTransactions.push({
                      id: `${yearToProcess}-${monthIndex}-${day}-${catKey}`,
                      company: `הכנסה מ-${categoryName}`,
                      amount: Number(value),
                      type: "inflow",
                      // Add a real date object for accurate sorting
                      date: new Date(yearToProcess, monthIndex, day + 1)
                  });
              }
          });
        }
      }
    }
    // No need to delete empty months, we'll handle it in formatting
  }

  // --- Format data for Recharts ---
  // Create a full 12-month structure for a consistent chart display
  const fullMonthlyData = monthNames.map(name => ({
      name,
      revenue: monthlyRevenue[name] || 0
  }));
  
  const categoryColors = ["#0ea5e9", "#8b5cf6", "#10b981", "#f97316", "#ef4444", "#ec4899", "#f59e0b"];
  const revenueByCategoryData = Object.entries(revenueByCategory).map(([name, value], index) => ({
      name,
      value,
      color: categoryColors[index % categoryColors.length]
  }));

  // Calculate average only based on months with actual revenue
  const revenueMonthsCount = Object.values(monthlyRevenue).filter(r => r > 0).length;
  const avgMonthlyRevenue = revenueMonthsCount > 0 ? totalRevenue / revenueMonthsCount : 0;

  // Sort all transactions by date and take the most recent 5
  const sortedTransactions = recentTransactions.sort((a, b) => b.date - a.date).slice(0, 5);

  console.log(`Processing complete for year ${yearToProcess}. Total Revenue: ${totalRevenue}`);

  const dashboardData = {
    mainMetrics: {
      totalRevenue: Math.round(totalRevenue),
      revenueChange: 15.2, // Placeholder
      activeUsers: transactionCount, // Total income transactions for the year
      usersChange: -1.5, // Placeholder
      avgMonthlyRevenue: Math.round(avgMonthlyRevenue),
      avgChange: 4.8, // Placeholder
    },
    monthlyRevenueData: fullMonthlyData,
    revenueByCategoryData: revenueByCategoryData.length > 0 ? revenueByCategoryData : [{ name: "אין נתונים", value: 1, color: "#6b7280" }],
    recentTransactions: sortedTransactions,
  };
  
  // Return both the processed data and the list of available years
  return { dashboardData, availableYears };
};

// --- API Route ---
// The route now checks for a 'year' query parameter
app.get("/api/dashboard/:userId", authenticateApiKey, async (req, res) => {
  const { userId } = req.params;
  const { year } = req.query; // e.g., ?year=2025
  try {
    // Pass the requested year to the data function
    const data = await getDashboardDataForUser(userId, year);
    res.json(data);
  } catch (error) {
    console.error(`API Error for userId ${userId} (year: ${year}):`, error.message);
    res.status(error.message.includes("not found") ? 404 : 500).json({ error: error.message });
  }
});

// --- Server Start ---
app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
