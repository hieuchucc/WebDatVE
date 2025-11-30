require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const http = require("http");
const { Server } = require("socket.io");

const connectDB = require("./db");

// ===== Routes =====
const tripsRouter = require("./routes/trips");
const holdsRouter = require("./routes/holds");
const bookingsRouter = require("./routes/bookings");
const paymentsRouter = require("./routes/payments");
const AuthRoute = require("./routes/auth.route");
const AdminRoute = require("./routes/admin.route");
const vnpayRoutes = require("./routes/payment.vnpay");
const momoRoutes = require("./routes/payment.momo");
const chatRouter = require("./routes/chat");
const employeeRouter = require("./routes/employee");
const reviewsRouter = require("./routes/reviews");
const shuttleRoutes = require("./routes/shuttle");

// ===== Jobs =====
const { seedNextDays, scheduleDailyJob } = require("./jobs/generateTrip");
const { scheduleReminderCron } = require("./jobs/reminder.cron");

const app = express();
const server = http.createServer(app);

// ===== CORS CONFIG =====
// CORS_ORIGIN có thể là 1 domain hoặc nhiều domain, ngăn cách bằng dấu phẩy
// VD: CORS_ORIGIN=http://localhost:5500,https://webdatve-frontend.onrender.com
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
  : ["*"];

app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
  })
);

// ===== SOCKET.IO =====
const io = new Server(server, {
  cors: {
    origin: corsOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

io.on("connection", (socket) => {
  socket.on("joinRoom", (roomId) => socket.join(roomId));

  socket.on("chatMessage", async (msg) => {
    const { ChatMessage } = require("./models/ChatMessage");

    await ChatMessage.create({
      roomId: msg.roomId,
      text: msg.text,
      senderType: msg.senderType,
      senderId: msg.senderId || null,
    });

    io.to(msg.roomId).emit("chatMessage", msg);
  });
});

// ===== MIDDLEWARE =====
app.use(cookieParser());
app.use(express.json({ limit: "200kb" }));

// ===== ROUTES =====
app.use("/api/trips", tripsRouter);
app.use("/api/holds", holdsRouter);
app.use("/api/bookings", bookingsRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/auth", AuthRoute);
app.use("/api/admin", AdminRoute);
app.use("/api/payment", vnpayRoutes);
app.use("/api/payment/momo", momoRoutes);
app.use("/api/chat", chatRouter);
app.use("/api/employee", employeeRouter);
app.use("/api/reviews", reviewsRouter);
app.use("/api/shuttles", shuttleRoutes);

// ===== HEALTHCHECK (tùy chọn) =====
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Backend is running" });
});

// ===== 404 =====
app.use((req, res) => res.status(404).json({ message: "Not found" }));

// ===== ERROR =====
app.use((err, req, res, next) => {
  console.error("❌ Server error:", err.message);
  res.status(500).json({ message: "Server error" });
});

// ===== START SERVER =====
(async () => {
  const MONGO_URI = process.env.MONGODB_URI;
  if (!MONGO_URI) {
    console.error("❌ Missing MONGODB_URI");
    process.exit(1);
  }

  await connectDB(MONGO_URI);

  // chỉ seed khi DEV
  if (process.env.NODE_ENV === "development") {
    await seedNextDays(60);
  }

  scheduleDailyJob();
  scheduleReminderCron();

  const PORT = process.env.PORT || 3000;
  const HOST = "0.0.0.0";

  server.listen(PORT, HOST, () => {
    console.log(`🚀 Server ready on port ${PORT}`);
  });
})();
