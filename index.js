require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb"); // ← ObjectId added
const admin = require("firebase-admin");
const port = process.env.PORT || 5000;
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

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
    origin: ["http://localhost:5173", "https://your-live-site.vercel.app"],
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
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

// HR-only middleware
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
    const requestCollection = db.collection("requests");
    const assignedAssetsCollection = db.collection("assignedAssets");
    const employeeAffiliationsCollection = db.collection(
      "employeeAffiliations"
    );
    const packagesCollection = db.collection("packages");
    const paymentsCollection = db.collection("payments");

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

    // GET → All affiliated employees for logged-in HR
    app.get("/my-employees", verifyJWT, verifyHR, async (req, res) => {
      const hrEmail = req.user.email;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      const employees = await employeeAffiliationsCollection
        .find({ hrEmail, status: "active" })
        .sort({ affiliationDate: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      const total = await db
        .collection("employeeAffiliations")
        .countDocuments({ hrEmail, status: "active" });

      const employeesWithCount = await Promise.all(
        employees.map(async (emp) => {
          const count = await db.collection("assignedAssets").countDocuments({
            employeeEmail: emp.employeeEmail,
            status: "assigned",
          });
          return { ...emp, assignedAssetsCount: count };
        })
      );

      res.send({
        employees: employeesWithCount,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1,
        },
      });
    });

    // GET → Colleagues in employee's affiliated companies
    app.get("/my-team", verifyJWT, async (req, res) => {
      const employeeEmail = req.user.email;

      try {
        // Get employee's active affiliations
        const affiliations = await employeeAffiliationsCollection
          .find({ employeeEmail, status: "active" })
          .toArray();

        if (affiliations.length === 0) {
          return res.send({ companies: [], colleagues: [] });
        }

        // Get all employees from same companies
        const companyHrEmails = affiliations.map((a) => a.hrEmail);
        const allAffiliated = await employeeAffiliationsCollection
          .find({ hrEmail: { $in: companyHrEmails }, status: "active" })
          .toArray();

        // Group by company
        const companies = affiliations.map((aff) => ({
          companyName: aff.companyName,
          companyLogo: aff.companyLogo,
          hrEmail: aff.hrEmail,
        }));

        // Colleagues (exclude self)
        const colleagues = allAffiliated
          .filter((emp) => emp.employeeEmail !== employeeEmail)
          .map((emp) => ({
            employeeName: emp.employeeName,
            employeeEmail: emp.employeeEmail,
            companyName: emp.companyName,
            companyLogo: emp.companyLogo,
          }));

        res.send({ companies, colleagues });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to load team" });
      }
    });

    // DELETE → Remove employee from team (HR only)
    app.delete(
      "/employee-affiliations/:email",
      verifyJWT,
      verifyHR,
      async (req, res) => {
        const employeeEmail = req.params.email;
        const hrEmail = req.user.email;

        try {
          await employeeAffiliationsCollection.updateOne(
            { employeeEmail, hrEmail },
            { $set: { status: "inactive" } }
          );

          await assignedAssetsCollection.updateMany(
            { employeeEmail, hrEmail, status: "assigned" },
            {
              $set: { status: "returned", returnDate: new Date() },
              $inc: { availableQuantity: 1 },
            }
          );

          const returnedAssets = await assignedAssetsCollection
            .find({ employeeEmail, hrEmail, status: "returned" })
            .toArray();

          for (const asset of returnedAssets) {
            await assetCollection.updateOne(
              { _id: new ObjectId(asset.assetId) },
              { $inc: { availableQuantity: 1 } }
            );
          }

          await userCollection.updateOne(
            { email: hrEmail },
            { $inc: { currentEmployees: -1 } }
          );

          res.send({ message: "Employee removed from team" });
        } catch (err) {
          res.status(500).send({ message: "Failed to remove employee" });
        }
      }
    );

    // PATCH → Update user profile (name, dateOfBirth, companyLogo)
    app.patch("/user/profile", verifyJWT, async (req, res) => {
      const { name, dateOfBirth, companyLogo } = req.body;
      const email = req.user.email;

      // At least one field must be provided
      if (!name && !dateOfBirth && !companyLogo) {
        return res.status(400).send({ message: "No data to update" });
      }

      try {
        const updateFields = {};
        if (name) updateFields.name = name.trim();
        if (dateOfBirth) updateFields.dateOfBirth = dateOfBirth;
        if (companyLogo) updateFields.companyLogo = companyLogo;

        const result = await userCollection.updateOne(
          { email },
          { $set: updateFields }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send({ message: "Profile updated successfully" });
      } catch (err) {
        console.error("Profile update error:", err);
        res.status(500).send({ message: "Failed to update profile" });
      }
    });

    // GET → Employee's company affiliations
    app.get("/my-affiliations", verifyJWT, async (req, res) => {
      const employeeEmail = req.user.email;

      const affiliations = await db
        .collection("employeeAffiliations")
        .find({ employeeEmail, status: "active" })
        .sort({ affiliationDate: -1 })
        .toArray();

      res.send(affiliations);
    });

    // =================== ASSET APIs (HR ONLY) ====================
    // GET → Paginated assets for HR + search
    app.get("/assets", verifyJWT, verifyHR, async (req, res) => {
      const hrEmail = req.user.email;
      const search = req.query.search || "";
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      try {
        const query = {
          hrEmail,
          productName: { $regex: search, $options: "i" },
        };

        const assets = await assetCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        const total = await assetCollection.countDocuments(query);

        res.send({
          assets,
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            totalItems: total,
            hasNext: page < Math.ceil(total / limit),
            hasPrev: page > 1,
          },
        });
      } catch (err) {
        res.status(500).send({ message: "Failed to load assets" });
      }
    });
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

    // ==================== REQUEST APIs ====================
    // POST → Employee creates asset request
    app.post("/requests", verifyJWT, async (req, res) => {
      const {
        assetId,
        assetName,
        assetType,
        companyName,
        hrEmail,
        note,
        requesterName,
        requesterEmail,
      } = req.body;

      const newRequest = {
        assetId,
        assetName,
        assetType,
        companyName,
        hrEmail,
        requesterEmail,
        requesterName,
        note: note || "",
        requestDate: new Date(),
        requestStatus: "pending",
      };

      const result = await requestCollection.insertOne(newRequest);
      res.status(201).send(result);
    });

    // GET → All pending requests for logged-in HR
    app.get("/requests", verifyJWT, verifyHR, async (req, res) => {
      const hrEmail = req.user.email;

      const requests = await requestCollection
        .find({ hrEmail: hrEmail, requestStatus: "pending" })
        .sort({ requestDate: -1 })
        .toArray();

      res.send(requests);
    });

    // PATCH → Approve request
    app.patch(
      "/requests/:id/approve",
      verifyJWT,
      verifyHR,
      async (req, res) => {
        const requestId = req.params.id;
        const hrEmail = req.user.email;

        try {
          const request = await requestCollection.findOne({
            _id: new ObjectId(requestId),
            hrEmail,
            requestStatus: "pending",
          });
          if (!request)
            return res.status(404).send({ message: "Request not found" });

          const asset = await assetCollection.findOne({
            _id: new ObjectId(request.assetId),
          });
          if (asset.availableQuantity <= 0) {
            return res
              .status(400)
              .send({ message: "Asset no longer available" });
          }

          await assetCollection.updateOne(
            { _id: new ObjectId(request.assetId) },
            { $inc: { availableQuantity: -1 } }
          );

          //  Create assigned Assets
          await assignedAssetsCollection.insertOne({
            assetId: request.assetId,
            assetName: request.assetName,
            assetImage: asset.productImage,
            assetType: request.assetType,
            employeeEmail: request.requesterEmail,
            employeeName: request.requesterName,
            hrEmail,
            companyName: request.companyName,
            assignmentDate: new Date(),
            status: "assigned",
          });

          //Check if first affiliation → create employeeAffiliations
          const existingAff = await employeeAffiliationsCollection.findOne({
            employeeEmail: request.requesterEmail,
            hrEmail,
          });

          if (!existingAff) {
            await employeeAffiliationsCollection.insertOne({
              employeeEmail: request.requesterEmail,
              employeeName: request.requesterName,
              hrEmail,
              companyName: request.companyName,
              companyLogo: req.hrUser.companyLogo || "",
              affiliationDate: new Date(),
              status: "active",
            });

            // Increase currentEmployees count in users collection
            await userCollection.updateOne(
              { email: hrEmail },
              { $inc: { currentEmployees: 1 } }
            );
          }

          // Update request status to approved
          await requestCollection.updateOne(
            { _id: new ObjectId(requestId) },
            { $set: { requestStatus: "approved", approvalDate: new Date() } }
          );

          res.send({ message: "Request approved successfully" });
        } catch (err) {
          console.error(err);
          res.status(500).send({ message: "Approval failed" });
        }
      }
    );

    // GET → All asset requests made by logged-in employee
    app.get("/my-requests", verifyJWT, async (req, res) => {
      const requesterEmail = req.user.email;

      try {
        const requests = await requestCollection
          .find({ requesterEmail })
          .sort({ requestDate: -1 })
          .toArray();

        res.send(requests);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to load request history" });
      }
    });

    // PATCH → Reject request
    app.patch("/requests/:id/reject", verifyJWT, verifyHR, async (req, res) => {
      const requestId = req.params.id;
      const hrEmail = req.user.email;

      const result = await requestCollection.updateOne(
        {
          _id: new ObjectId(requestId),
          hrEmail,
          requestStatus: "pending",
        },
        { $set: { requestStatus: "rejected", rejectionDate: new Date() } }
      );

      if (result.modifiedCount === 0) {
        return res
          .status(404)
          .send({ message: "Request not found or already processed" });
      }

      res.send({ message: "Request rejected" });
    });

    // ==================assigned assets related APIs ==================
    // GET → All assigned assets for logged-in employee (from all companies)
    app.get("/my-assets", verifyJWT, async (req, res) => {
      const employeeEmail = req.user.email;

      const assets = await assignedAssetsCollection
        .find({
          employeeEmail,
          status: "assigned",
        })
        .sort({ assignmentDate: -1 })
        .toArray();

      res.send(assets);
    });

    // PATCH → Employee returns a returnable asset
    app.patch("/assigned-assets/:id/return", verifyJWT, async (req, res) => {
      const assignedId = req.params.id;
      const employeeEmail = req.user.email;

      try {
        // Find the assigned asset
        const assigned = await assignedAssetsCollection.findOne({
          _id: new ObjectId(assignedId),
          employeeEmail,
          status: "assigned",
          assetType: "Returnable",
        });

        // Update status to returned
        await assignedAssetsCollection.updateOne(
          { _id: new ObjectId(assignedId) },
          {
            $set: {
              status: "returned",
              returnDate: new Date(),
            },
          }
        );

        // Increment availableQuantity back in assets collection
        await assetCollection.updateOne(
          { _id: new ObjectId(assigned.assetId) },
          { $inc: { availableQuantity: 1 } }
        );

        res.send({ message: "Asset returned successfully" });
      } catch (err) {
        res.status(500).send({ message: "Return failed" });
      }
    });

    //======================= PACKAGE APIs ====================
    // GET → All available packages
    app.get("/packages", async (req, res) => {
      const packages = await packagesCollection
        .find({})
        .sort({ price: 1 })
        .toArray();

      res.send(packages);
    });

    // ======================= PAYMENT / STRIPE APIs ====================

    // POST → Create Stripe Checkout Session
    app.post(
      "/create-checkout-session",
      verifyJWT,
      verifyHR,
      async (req, res) => {
        const { packageName } = req.body;

        try {
          const selectedPackage = await packagesCollection.findOne({
            name: packageName,
          });
          if (!selectedPackage)
            return res.status(400).send({ message: "Package not found" });

          // Free package → direct upgrade
          if (selectedPackage.price === 0) {
            await userCollection.updateOne(
              { email: req.user.email },
              {
                $set: {
                  subscription: selectedPackage.name,
                  packageLimit: selectedPackage.employeeLimit,
                },
              }
            );

            await paymentsCollection.insertOne({
              hrEmail: req.user.email,
              packageName: selectedPackage.name,
              employeeLimit: selectedPackage.employeeLimit,
              amount: 0,
              transactionId: "free-" + Date.now(),
              paymentDate: new Date(),
              status: "completed",
            });

            return res.send({
              url: `${process.env.CLIENT_URL}/hr/upgrade-package?success=free`,
            });
          }

          const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [
              {
                price_data: {
                  currency: "usd",
                  product_data: {
                    name: `AssetVerse ${selectedPackage.name} Package`,
                    description: `Up to ${selectedPackage.employeeLimit} employees`,
                  },
                  unit_amount: selectedPackage.price * 100,
                },
                quantity: 1,
              },
            ],
            mode: "payment",
            success_url: `${process.env.CLIENT_URL}/hr/upgrade-package?session_id={CHECKOUT_SESSION_ID}&success=true`,
            cancel_url: `${process.env.CLIENT_URL}/hr/upgrade-package?canceled=true`,
            metadata: {
              hrEmail: req.user.email,
              packageName: selectedPackage.name,
              employeeLimit: selectedPackage.employeeLimit.toString(),
            },
          });

          res.send({ url: session.url });
        } catch (err) {
          console.error(err);
          res.status(500).send({ message: "Checkout failed" });
        }
      }
    );

    // POST → Confirm payment and upgrade package (called on return)
    app.post("/confirm-payment", verifyJWT, verifyHR, async (req, res) => {
      const { session_id } = req.body;

      if (!session_id)
        return res.status(400).send({ message: "No session ID" });

      try {
        const session = await stripe.checkout.sessions.retrieve(session_id);

        if (session.payment_status !== "paid") {
          return res.status(400).send({ message: "Payment not completed" });
        }

        const { hrEmail, packageName, employeeLimit } = session.metadata;

        const pkg = await packagesCollection.findOne({ name: packageName });

        // Upgrade user
        await userCollection.updateOne(
          { email: hrEmail },
          {
            $set: {
              subscription: pkg.name,
              packageLimit: pkg.employeeLimit,
            },
          }
        );
        const transactionId = session.payment_intent;
        const query = { transactionId: transactionId };
        const existingPayment = await paymentsCollection.findOne(query);

        if (existingPayment) {
          return res.send({ message: "Package already upgraded" });
        }

        // Save payment record
        await paymentsCollection.insertOne({
          hrEmail,
          packageName: pkg.name,
          employeeLimit: pkg.employeeLimit,
          amount: pkg.price,
          transactionId: session.payment_intent,
          paymentDate: new Date(),
          status: "completed",
        });

        res.send({ success: true, message: "Package upgraded!" });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Verification failed" });
      }
    });

    // GET → Payment history for logged-in HR
    app.get("/payments", verifyJWT, verifyHR, async (req, res) => {
      const hrEmail = req.user.email;

      try {
        const payments = await db
          .collection("payments")
          .find({ hrEmail })
          .sort({ paymentDate: -1 })
          .toArray();

        res.send(payments);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to load payment history" });
      }
    });

    // ======================= ANALYTICS APIs ====================
    // GET → Analytics for HR dashboard
    app.get("/analytics", verifyJWT, verifyHR, async (req, res) => {
      const hrEmail = req.user.email;

      try {
        // Pie: Returnable vs Non-returnable count
        const typeAggregation = await assetCollection
          .aggregate([
            { $match: { hrEmail } },
            { $group: { _id: "$productType", count: { $sum: 1 } } },
          ])
          .toArray();

        const pieData = typeAggregation.map((item) => ({
          name: item._id,
          value: item.count,
        }));

        // Bar: Top 5 most requested assets (approved requests)
        const topRequested = await requestCollection
          .aggregate([
            { $match: { hrEmail, requestStatus: "approved" } },
            { $group: { _id: "$assetName", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 },
          ])
          .toArray();

        const barData = topRequested.map((item) => ({
          name: item._id || "Unknown",
          requests: item.count,
        }));

        res.send({ pieData, barData });
      } catch (err) {
        res.status(500).send({ message: "Analytics failed" });
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
