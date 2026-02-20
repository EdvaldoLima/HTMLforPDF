import amqp from 'amqplib';

const RABBIT_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

let connection: amqp.Connection | null = null;

export async function getConnection(): Promise<amqp.Connection> {
  if (connection) return connection;
  connection = await amqp.connect(RABBIT_URL);
  return connection;
}

export async function createChannel() {
  const conn = await getConnection();
  const ch = await conn.createChannel();
  return ch;
}

export default { getConnection, createChannel };
