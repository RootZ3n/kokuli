import express from "express";
import path from "path";
import apiRouter from "./api";

const app = express();
const PORT = parseInt(process.env.KRAKZEN_PORT || "3000", 10);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// API routes
app.use("/api", apiRouter);

// HTML page routes
app.get("/atlantis", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "atlantis.html"));
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[krakzen-web] Dashboard:  http://localhost:${PORT}`);
  console.log(`[krakzen-web] Atlantis:   http://localhost:${PORT}/atlantis`);
  console.log(`[krakzen-web] API:        http://localhost:${PORT}/api`);
});
