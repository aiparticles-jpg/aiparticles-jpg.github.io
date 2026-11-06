const express = require("express");

const app = express();
const port = Number(process.env.PORT) || 3000;

app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "voicelink-backend"
  });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`VoiceLink backend listening on port ${port}`);
});
