const express = require("express")
const admin = require("firebase-admin")

// --- Firebase Admin SDK Initialization from Environment Variable ---
// This is the correct way to initialize for a production server like Render.
try {
  // Render automatically provides the environment variable content as a string.
  // We need to parse it into a JSON object.
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  })
} catch (error) {
  console.error("שגיאה קריטית: לא ניתן היה לפענח את מפתח הגישה של Firebase.", error)
  console.error("ודא שהגדרת משתנה סביבה בשם FIREBASE_SERVICE_ACCOUNT ב-Render עם כל התוכן של קובץ ה-JSON.")
  process.exit(1)
}

const db = admin.firestore()
const app = express()
const PORT = process.env.PORT || 3000
// Read the API_KEY from the environment variable set in Render
const API_KEY = process.env.API_KEY || "YOUR_SUPER_SECRET_API_KEY_FALLBACK"

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
    console.error("Forbidden: Invalid API key received:", apiKey) // ADDED LOG
    return res.status(403).json({ error: "Forbidden: Invalid API key." })
  }
  next()
}

// --- Real Data Source from Firestore (for a SPECIFIC user) ---
const getDashboardDataForUser = async (userId) => {
  const collectionName = "users"
  const userDocRef = db.collection(collectionName).doc(userId)
  const doc = await userDocRef.get()

  if (!doc.exists) {
    throw new Error(`User with ID '${userId}' not found`)
  }

  const userData = doc.data()
  const transactions = userData.transactions || []

  if (!Array.isArray(transactions)) {
    throw new Error(`The 'transactions' field for user '${userId}' is not an array.`)
  }

  let totalRevenue = 0
  const recentTransactions = []

  transactions.forEach((transaction, index) => {
    if (transaction.amount && transaction.amount > 0) {
      totalRevenue += transaction.amount
    }
    recentTransactions.push({
      id: transaction.id || `tx_${index}`,
      company: transaction.description || "Unknown Company",
      amount: transaction.amount || 0,
      type: (transaction.amount || 0) > 0 ? "inflow" : "outflow",
    })
  })

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
    recentTransactions: recentTransactions.slice(-5).reverse(),
  }
}

// --- API Routes ---
app.get("/api/dashboard/:userId", authenticateApiKey, async (req, res) => {
  try {
    const { userId } = req.params
    const data = await getDashboardDataForUser(userId)
    res.json(data)
  } catch (error) {
    console.error(`שגיאה ב-API של הדשבורד עבור משתמש ${req.params.userId}:`, error.message) // ADDED LOG
    res.status(500).json({ error: error.message })
  }
})

// --- Start the Server ---
app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`)
})
