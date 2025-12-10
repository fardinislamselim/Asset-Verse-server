require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const admin = require("firebase-admin");
const port = process.env.PORT || 5000;

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf-8"
);
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
// middleware
app.use(express.json());
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  console.log(token);
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    console.log(decoded);
    next();
  } catch (err) {
    console.log(err);
    return res.status(401).send({ message: "Unauthorized Access!" });
  }
};

// Optional: HR-only middleware
const verifyHR = async (req, res, next) => {
  try {
    const userDoc = await db.collection("users").findOne({ email: req.user.email });
    if (userDoc?.role !== "hr") {
      return res.status(403).json({ message: "HR access only" });
    }
    next();
  } catch (err) {
    res.status(403).json({ message: "Forbidden" });
  }
};

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const db = client.db("AssetsVerse");
    const userCollection = db.collection("users");
    const assetCollection = db.collection("assets");

    //----------------- user related API-----------------------
    // post /users
    app.post("/users", async (req, res) => {
      const userInfo = req.body;
      const result = await userCollection.insertOne(userInfo);
      res.send(result);
    });

    // get /single user
    app.get("/user", verifyJWT, async (req, res) => {
      const query = { email: req.tokenEmail };
      const user = await userCollection.findOne(query);
      res.send(user);
    });

    //----------------- asset related API -----------------------
    // POST /assets
    app.post("/assets", verifyJWT, async (req, res) => {
      const assetInfo = req.body;
      const result = await assetCollection.insertOne(assetInfo);
      return res.send(result);
    });

// GET → All assets of logged HR + search
app.get("/assets", verifyJWT, async (req, res) => {
  const user = await userCollection.findOne({ email: req.tokenEmail });
  if (user?.role !== "hr") return res.status(403).send({ message: "HR only" });

  const search = req.query.search || "";
  const assets = await assetCollection
    .find({
      hrEmail: req.tokenEmail,
      productName: { $regex: search, $options: "i" },
    })
    .sort({ createdAt: -1 })
    .toArray();

  res.send(assets);
});

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("AssetsVerse is running.....");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
