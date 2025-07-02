const express = require('express');
const admin = require('firebase-admin');

// --- Firebase Admin SDK Initialization ---
try {
  const serviceAccount = require('./gilfinnas-firebase-adminsdk-fbsvc-808c9ec17b.json'); 
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} catch (error) {
  console.error("שגיאה: לא ניתן היה למצוא את קובץ המפתח של Firebase. ודא שהקובץ נמצא בתיקייה הנכונה וששמו נכון בקוד.");
  process.exit(1);
}

const db = admin.firestore();
const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = "YOUR_SUPER_SECRET_API_KEY"; 

// --- CORS Middleware ---
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, x-api-key');
  next();
});

// --- Middleware for API Key Authentication ---
const authenticateApiKey = (req, res, next) => {
  const apiKey = req.header('x-api-key');
  if (!apiKey || apiKey !== API_KEY) {
    return res.status(403).json({ error: 'Forbidden: Invalid API key.' });
  }
  next();
};

// --- Real Data Source from Firestore (for a SPECIFIC user) ---
const getDashboardDataForUser = async (userId) => {
  const collectionName = 'users';
  const userDocRef = db.collection(collectionName).doc(userId);
  const doc = await userDocRef.get();

  if (!doc.exists) {
    throw new Error(`User with ID '${userId}' not found in collection '${collectionName}'`);
  }
  
  const userData = doc.data();
  // This assumes the user document contains an array called 'transactions'.
  const transactions = userData.transactions || []; 

  if (!Array.isArray(transactions)) {
      throw new Error(`The 'transactions' field for user '${userId}' is not an array.`);
  }

  let totalRevenue = 0;
  const recentTransactions = [];

  transactions.forEach((transaction, index) => {
    if (transaction.amount && transaction.amount > 0) {
      totalRevenue += transaction.amount;
    }
    recentTransactions.push({
      id: transaction.id || `tx_${index}`,
      company: transaction.description || 'Unknown Company',
      amount: transaction.amount || 0,
      type: (transaction.amount || 0) > 0 ? 'inflow' : 'outflow',
    });
  });
  
  // The following data is still mocked. You would calculate this based on the user's transactions.
  return {
    mainMetrics: {
      totalRevenue: totalRevenue,
      revenueChange: 15.2,
      activeUsers: transactions.length,
      usersChange: -1.5,
      avgMonthlyRevenue: 41300,
      avgChange: 4.8,
    },
    monthlyRevenueData: [
      { name: 'ינו׳', revenue: 32000 }, { name: 'פבר׳', revenue: 41000 },
    ],
    revenueByCategoryData: [
      { name: 'שירותים', value: 450, color: '#0ea5e9' }, { name: 'מוצרים', value: 250, color: '#8b5cf6' },
    ],
    recentTransactions: recentTransactions.slice(-5).reverse(),
  };
};

// --- API Routes ---
app.get('/', (req, res) => {
  res.send('Cash Flow API Server is running. Use /api/dashboard/:userId to get data.');
});

app.get('/api/dashboard/:userId', authenticateApiKey, async (req, res) => {
  try {
    const userId = req.params.userId;
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required.' });
    }
    const data = await getDashboardDataForUser(userId);
    res.json(data);
  } catch (error) {
    console.error("Error fetching dashboard data:", error);
    res.status(500).json({ error: error.message });
  }
});

// --- Start the Server ---
app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
