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
    console.warn("SECURITY WARNING: API_KEY is not set.");
    return next();
  }
  if (!receivedApiKey || receivedApiKey !== API_KEY) {
    console.error(`Forbidden: Invalid API key received.`);
    return res.status(403).json({ error: "Forbidden: Invalid API key." });
  }
  next();
};

// --- Data Processing Function (with REAL data) ---
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

  let totalRevenue = 0;
  const monthlyRevenue = {}; // "2025-07": 12000
  const revenueByCategory = {}; // "מכירות (אשראי)": 5000
  const recentTransactions = [];
  let transactionCount = 0;

  const monthNames = ["ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳"];

  // Loop through all years, months, and categories to aggregate data
  for (const year in yearsData) {
    for (const monthIndex in yearsData[year]) {
      const monthData = yearsData[year][monthIndex];
      const categories = monthData.categories || {};
      const customNames = monthData.customNames || {};
      
      const monthKey = `${year}-${monthNames[monthIndex]}`;
      monthlyRevenue[monthKey] = 0;

      for (const catKey in categories) {
        // We consider "income" type categories as revenue
        if (catKey.includes("sales") || catKey.includes("exempt")) {
          const dailyValues = categories[catKey] || [];
          const categorySum = dailyValues.reduce((sum, value) => sum + (Number(value) || 0), 0);

          if (categorySum > 0) {
            totalRevenue += categorySum;
            monthlyRevenue[monthKey] += categorySum;

            // Aggregate by category name
            const categoryName = customNames[catKey] || catKey.replace(/_/g, " ");
            revenueByCategory[categoryName] = (revenueByCategory[categoryName] || 0) + categorySum;
            
            // Create recent transactions from daily values
            dailyValues.forEach((value, day) => {
                if (Number(value) > 0) {
                    transactionCount++;
                    recentTransactions.push({
                        id: `${year}-${monthIndex}-${day}-${catKey}`,
                        company: `הכנסה מ-${categoryName}`,
                        amount: Number(value),
                        type: "inflow",
                    });
                }
            });
          }
        }
      }
      // If a month had no revenue, remove it
      if (monthlyRevenue[monthKey] === 0) {
        delete monthlyRevenue[monthKey];
      }
    }
  }

  // --- Format data for Recharts ---
  const monthlyRevenueData = Object.entries(monthlyRevenue).map(([name, revenue]) => ({ name: name.split('-')[1], revenue }));
  
  const categoryColors = ["#0ea5e9", "#8b5cf6", "#10b981", "#f97316", "#ef4444"];
  const revenueByCategoryData = Object.entries(revenueByCategory).map(([name, value], index) => ({
      name,
      value,
      color: categoryColors[index % categoryColors.length]
  }));

  const avgMonthlyRevenue = monthlyRevenueData.length > 0 ? totalRevenue / monthlyRevenueData.length : 0;

  console.log(`Processing complete. Total Revenue: ${totalRevenue}`);

  return {
    mainMetrics: {
      totalRevenue: Math.round(totalRevenue),
      revenueChange: 15.2, // Placeholder
      activeUsers: transactionCount, // Changed to show total income transactions
      usersChange: -1.5, // Placeholder
      avgMonthlyRevenue: Math.round(avgMonthlyRevenue),
      avgChange: 4.8, // Placeholder
    },
    monthlyRevenueData: monthlyRevenueData.length > 0 ? monthlyRevenueData : [{ name: "אין נתונים", revenue: 0 }],
    revenueByCategoryData: revenueByCategoryData.length > 0 ? revenueByCategoryData : [{ name: "אין נתונים", value: 1, color: "#6b7280" }],
    recentTransactions: recentTransactions.slice(-5).reverse(),
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
