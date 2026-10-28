import amqp from 'amqplib';
import { config } from '../config/env.js';
import logger from '../utils/logger.js';

let pending: Promise<amqp.ChannelModel> | undefined;

export function getConnection(): Promise<amqp.ChannelModel> {
  if (!pending) {
    const attempt = amqp.connect(config.rabbitUrl, { timeout: 10_000 }).then((connection) => {
      connection.on('error', () => logger.error('RabbitMQ connection error'));

      connection.once('close', () => {
        if (pending === attempt) pending = undefined;
      });

      return connection;
    });

    pending = attempt;

    void attempt.catch(() => {
      if (pending === attempt) pending = undefined;
    });
  }

  return pending;
}

export async function createChannel() {
  const channel = await (await getConnection()).createConfirmChannel();

  channel.on('error', () => logger.error('RabbitMQ channel error'));

  return channel;
}

export async function closeConnection() {
  const connection = pending;

  pending = undefined;
  if (connection) await (await connection).close();
}
