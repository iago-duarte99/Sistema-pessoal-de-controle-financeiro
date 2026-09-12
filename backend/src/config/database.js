import './env.js';
import mysql from 'mysql2/promise';

export const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'finance_app',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'controle_financeiro',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 100,
  dateStrings: true,
  charset: 'utf8mb4',
  multipleStatements: false
});

export async function transaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}
