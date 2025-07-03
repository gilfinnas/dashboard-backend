const express = require("express")
const admin = require("firebase-admin")

// --- Firebase Admin SDK Initialization from Environment Variable ---
try {
  // Render automatically provides the environment variable content as a string.
  // We need to parse it into a JSON object.
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  })
  console.log("Firebase Admin SDK initialized successfully.");
} catch (error) {
  console.error("CRITICAL ERROR: Could not parse Firebase service account JSON.", error)
  console.error("Please ensure the FIREBASE_SERVICE_ACCOUNT environment variable in Render is set correctly with the full JSON content.")
  process.exit(1)
}

const db = admin.firestore()
const app = express()
const PORT = process.env.PORT || 3000
const API_KEY = process.env.API_KEY

// --- CORS Middleware for Production ---
const allowedOrigins = [
  "https://dashboard-frontend-five-azure.vercel.app", // Your Vercel Dashboard
  "https://gilfinnas.com", // Your main site
  "https://www.gilfinnas.com",
]
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin)
  }
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, x-api-key")
  next()
})

// --- Middleware for API Key Authentication ---
const authenticateApiKey = (req, res, next) => {
  const apiKey = req.header("x-api-key")
  if (!apiKey || apiKey !== API_KEY) {
    console.error("Forbidden: Invalid API key received:", apiKey)
    return res.status(403).json({ error: "Forbidden: Invalid API key." })
  }
  next()
}

// --- Real Data Source from Firestore (for a SPECIFIC user) ---
const getDashboardDataForUser = async (userId) => {
  // --- START OF CHANGES: Added detailed logging for Firestore access ---
  console.log(`Attempting to fetch data for userId: ${userId}`);
  const userDocRef = db.collection("users").doc(userId);
  
  let doc;
  try {
    doc = await userDocRef.get();
    console.log(`Firestore 'get' operation completed for userId: ${userId}`);
  } catch (firestoreError) {
    console.error(`Firestore Error when trying to get document for userId: ${userId}`, firestoreError);
    // This error often indicates a problem with permissions (Security Rules) or connectivity.
    throw new Error(`Could not access database. Check server permissions and connectivity. Original error: ${firestoreError.message}`);
  }
  // --- END OF CHANGES ---

  if (!doc.exists) {
    console.error(`User document not found for userId: ${userId}`);
    // Throw a specific error for "not found"
    throw new Error(`User with ID '${userId}' not found in the database.`);
  }

  console.log(`Document found for userId: ${userId}. Processing data...`);
  const userData = doc.data();
  // Use 'transactions' from userData, but default to an empty array if it doesn't exist
  const transactions = userData.transactions || [];

  if (!Array.isArray(transactions)) {
    console.error(`The 'transactions' field for user '${userId}' is not an array. Type is: ${typeof transactions}`);
    throw new Error(`Data format error: The 'transactions' field for user '${userId}' is not an array.`);
  }

  let totalRevenue = 0;
  const recentTransactions = [];

  transactions.forEach((transaction, index) => {
    // Ensure the transaction and its amount are valid before processing
    if (transaction && typeof transaction.amount === 'number' && transaction.amount > 0) {
      totalRevenue += transaction.amount;
    }
    recentTransactions.push({
      id: transaction.id || `tx_${index}`,
      company: transaction.description || "Unknown Company",
      amount: transaction.amount || 0,
      type: (transaction.amount || 0) >= 0 ? "inflow" : "outflow", // Changed to >= 0 for inflow
    });
  });

  console.log(`Data processing complete for userId: ${userId}. Total revenue: ${totalRevenue}`);

  // The following data is still mocked. You would calculate this based on the user's transactions.
  return {
    mainMetrics: {
      totalRevenue,
      revenueChange: 15.2,
      activeUsers: transactions.length,
      usersChange: -1.5,
      avgMonthlyRevenue: 41300,
      avgChange: 4.8,
    },
    monthlyRevenueData: [
      { name: "ינו׳", revenue: 32000 },
      { name: "פבר׳", revenue: 41000 },
    ],
    revenueByCategoryData: [
      { name: "שירותים", value: 450, color: "#0ea5e9" },
      { name: "מוצרים", value: 250, color: "#8b5cf6" },
    ],
    // Return the last 5 transactions, reversed to show newest first
    recentTransactions: recentTransactions.slice(-5).reverse(),
  };
};

// --- API Routes ---
app.get("/api/dashboard/:userId", authenticateApiKey, async (req, res) => {
  const { userId } = req.params;
  try {
    const data = await getDashboardDataForUser(userId);
    res.json(data);
  } catch (error) {
    console.error(`API Error for userId ${userId}:`, error.message);
    // Send a more specific status code if the user was not found
    if (error.message.includes("not found")) {
        res.status(404).json({ error: error.message });
    } else {
        res.status(500).json({ error: error.message });
    }
  }
});

// --- Start the Server ---
app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
  if (!API_KEY) {
      console.warn("WARNING: API_KEY environment variable is not set. The API will not be secure.");
  }
});
