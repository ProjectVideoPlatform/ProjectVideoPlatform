// services/rabbitmq/connection.js
const amqp = require('amqplib');
const config = require('../../config/rabbitmq');

let connection;
let channel;

async function getChannel() {
    // ถ้ามี channel แล้ว ให้คืนค่าทันที
    if (channel && channel.connection && channel.connection.stream.readable) {
        return channel;
    }

    try {
        // ถ้า connection ปิดอยู่ ให้สร้างใหม่
        if (!connection || !connection.stream.readable) {
            connection = await amqp.connect(config.url);
            console.log('✅ RabbitMQ connected');
            
            connection.on('close', () => {
                console.log('RabbitMQ connection closed');
                channel = null;
                connection = null;
            });

            connection.on('error', (err) => {
                console.error('RabbitMQ connection error:', err);
                channel = null;
                connection = null;
            });
        }

        channel = await connection.createChannel();
        console.log('✅ RabbitMQ channel created');
        
        return channel;
    } catch (error) {
        console.error('❌ Failed to connect to RabbitMQ:', error);
        channel = null;
        connection = null;
        throw error;
    }
}

module.exports = { getChannel };