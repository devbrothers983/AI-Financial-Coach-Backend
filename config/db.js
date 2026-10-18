import mongoose from "mongoose";

// Cached across invocations so a serverless function reuses the same
// connection on warm starts instead of opening a new one per request
// (which would quickly exhaust Atlas's connection limit). Harmless for
// the traditional long-running server too — it just means calling this
// twice is a no-op the second time.
let connectionPromise = null;

const connectDB = async () => {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(process.env.MONGO_URI).catch((error) => {
      connectionPromise = null;
      throw error;
    });
  }

  const conn = await connectionPromise;
  console.log(`Connected to MongoDB ${conn.connection.host}`);
  return conn.connection;
};

export default connectDB;