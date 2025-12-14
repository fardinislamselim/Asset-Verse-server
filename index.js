require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb"); // ← ObjectId added
const admin = require("firebase-admin");
const port = process.env.PORT || 5000;

// Firebase Admin Init
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf-8"
);
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();

// Middleware
app.use(express.json());
app.use(
  cors({
    origin: ["http://localhost:5173", "https://your-live-site.vercel.app"], // add live URL later
    credentials: true,
  })
);

// Global db variable
let db;

// Firebase JWT Verify
const verifyJWT = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized Access!" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded; // email, uid, etc.
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

// HR-only middleware (now works because db is available)
const verifyHR = async (req, res, next) => {
  try {
    const user = await db
      .collection("users")
      .findOne({ email: req.user.email });
    if (!user || user.role !== "hr") {
      return res.status(403).json({ message: "HR access only" });
    }
    req.hrUser = user;
    next();
  } catch (err) {
    return res.status(403).json({ message: "Forbidden" });
  }
};

// MongoDB Connection
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    db = client.db("AssetsVerse");
    console.log("Connected to MongoDB!");

    const userCollection = db.collection("users");
    const assetCollection = db.collection("assets");

    // ==================== USER APIs ====================

    //  POST → Add User
    app.post("/users", async (req, res) => {
      const user = req.body;
      const existing = await userCollection.findOne({ email: user.email });
      if (existing)
        return res.send({ message: "User exists", insertedId: null });
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.get("/user", verifyJWT, async (req, res) => {
      const user = await userCollection.findOne({ email: req.user.email });
      res.send(user || {});
    });

    // ==================== ASSET APIs (HR ONLY) ====================

    // POST → Add Asset
    app.post("/assets", verifyJWT, verifyHR, async (req, res) => {
      const asset = req.body;

      const newAsset = {
        ...asset,
        hrEmail: req.user.email,
        companyName: req.hrUser.companyName,
        availableQuantity: asset.productQuantity,
        createdAt: new Date(),
      };

      const result = await assetCollection.insertOne(newAsset);
      res.send(result);
    });

    // GET → All assets for HR + search
    app.get("/assets", verifyJWT, verifyHR, async (req, res) => {
      const search = req.query.search || "";
      const assets = await assetCollection
        .find({
          hrEmail: req.user.email,
          productName: { $regex: search, $options: "i" },
        })
        .sort({ createdAt: -1 })
        .toArray();

      res.send(assets);
    });

    // PUT → Edit Asset
    app.put("/assets/:id", verifyJWT, verifyHR, async (req, res) => {
      const { id } = req.params;
      const updateData = req.body;

      const result = await assetCollection.updateOne(
        { _id: new ObjectId(id), hrEmail: req.user.email },
        {
          $set: {
            productName: updateData.productName,
            productImage: updateData.productImage,
            productType: updateData.productType,
            productQuantity: updateData.productQuantity,
            availableQuantity: updateData.productQuantity,
          },
        }
      );

      if (result.matchedCount === 0) {
        return res.status(404).send({ message: "Asset not found" });
      }
      res.send({ message: "Updated", modifiedCount: result.modifiedCount });
    });

    // DELETE → Delete Asset
    app.delete("/assets/:id", verifyJWT, verifyHR, async (req, res) => {
      const { id } = req.params;
      const result = await assetCollection.deleteOne({
        _id: new ObjectId(id),
        hrEmail: req.user.email,
      });

      if (result.deletedCount === 0) {
        return res.status(404).send({ message: "Asset not found" });
      }
      res.send({ message: "Asset deleted" });
    });

    // GET → All available assets across all companies (quantity > 0)
    app.get("/available-assets", verifyJWT, async (req, res) => {
      try {
        const assets = await assetCollection
          .find({ availableQuantity: { $gt: 0 } })
          .project({
            productName: 1,
            productImage: 1,
            productType: 1,
            availableQuantity: 1,
            companyName: 1,
            hrEmail: 1,
          })
          .toArray();

        res.send(assets);
      } catch (err) {
        res.status(500).send({ message: "Failed to load assets" });
      }
    });

    
    // ------
  } catch (error) {
    console.error("MongoDB connection failed:", error);
  }
}

run().catch(console.dir);

// Health check
app.get("/", (req, res) => {
  res.send("AssetVerse Server is running perfectly!");
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
