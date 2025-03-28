require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { createServer } = require("http");
const { Server } = require("socket.io");
const User = require("./models/User");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

// ✅ MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Connection Error:", err));

// ✅ User Authentication Routes
app.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const existingUser = await User.findOne({ email });

    if (existingUser) return res.status(400).json({ error: "Email already in use" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, email, password: hashedPassword });
    await newUser.save();

    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    res.status(500).json({ error: "Registration failed", details: error });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user) return res.status(400).json({ error: "User not found" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: "Invalid password" });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });

    res.json({ message: "Login successful", token });
  } catch (error) {
    res.status(500).json({ error: "Login failed", details: error });
  }
});

// ✅ Socket.io Setup for 1-on-1 Chat
let waitingUser = null;

io.on("connection", (socket) => {
  console.log("🔵 A user connected:", socket.id);

  socket.on("user:join", (user) => {
    socket.username = user.username;

    if (waitingUser) {
      socket.partner = waitingUser;
      waitingUser.partner = socket;

      socket.emit("chat:matched", { message: `Connected to ${waitingUser.username}!` });
      waitingUser.emit("chat:matched", { message: `Connected to ${socket.username}!` });

      waitingUser = null;
    } else {
      waitingUser = socket;
      socket.emit("chat:waiting", { message: "Waiting for another user to join..." });
    }
  });

  socket.on("chat:message", (data) => {
    if (socket.partner) {
      socket.partner.emit("chat:message", { sender: socket.username, text: data.text });
    }
  });

  socket.on("chat:next", () => {
    if (socket.partner) {
      socket.partner.emit("chat:ended", { message: "Partner left. Searching for a new user..." });
      socket.partner.partner = null;
    }

    socket.partner = null;
    waitingUser = socket;
    socket.emit("chat:waiting", { message: "Searching for a new partner..." });
  });

  socket.on("disconnect", () => {
    console.log("🔴 A user disconnected:", socket.id);

    if (socket.partner) {
      socket.partner.emit("chat:ended", { message: "Your partner disconnected. Searching for a new user..." });
      socket.partner.partner = null;
    }

    if (waitingUser === socket) {
      waitingUser = null;
    }
  });
});

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
