const fs = require("fs");
const path = require("path");

let appConfig = {};
try {
  appConfig = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../config.json"), "utf8"),
  );
} catch {
  console.log("No config.json found or invalid format.");
}

/** @type {import('next').NextConfig} */
module.exports = {
  output: "export",
  distDir: process.env.NODE_ENV === "production" ? "../app" : ".next",
  trailingSlash: true,
  env: {
    NEXT_PUBLIC_SITE_URL:
      appConfig.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL,
  },
  images: {
    unoptimized: true,
  },
  webpack: (config) => {
    return config;
  },
};
