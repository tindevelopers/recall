import jwt from "jsonwebtoken";
import db from "../db.js";

export function getAuthTokenForUser(user) {
  if (!process.env.SECRET || process.env.SECRET.trim() === '') {
    throw new Error('SECRET environment variable is not set');
  }
  return jwt.sign({ id: user.id }, process.env.SECRET);
}

export async function getUserFromAuthToken(token) {
  if (!process.env.SECRET || process.env.SECRET.trim() === '') {
    throw new Error('SECRET environment variable is not set');
  }
  if (!token) {
    return null;
  }
  try {
    const decoded = jwt.verify(token, process.env.SECRET);
    return db.User.findByPk(decoded.id);
  } catch (err) {
    // Invalid token - return null instead of throwing
    return null;
  }
}
