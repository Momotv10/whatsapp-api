const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// إعداد واتساب
const client = new Client({
    authStrategy: new LocalAuth()
});

client.on('qr', async (qr) => {
    console.log("📌 امسح رمز الـ QR لتسجيل الدخول إلى واتساب:");

    // توليد رابط QR كصورة
    const qrImage = await qrcode.toDataURL(qr);
    console.log("🔗 رابط QR Code (افتحه في المتصفح لمسحه):");
    console.log(qrImage);
});

client.on('ready', () => {
    console.log('✅ WhatsApp Client جاهز للعمل!');
});

// API لإرسال رسالة عبر واتساب
app.post('/send', async (req, res) => {
    const { phone, message } = req.body;

    if (!phone || !message) {
        return res.status(400).json({ success: false, error: "⚠️ رقم الهاتف والرسالة مطلوبان!" });
    }

    try {
        await client.sendMessage(`${phone}@c.us`, message);
        res.json({ success: true, message: "✅ تم إرسال الرسالة بنجاح!" });
    } catch (error) {
        res.status(500).json({ success: false, error: "❌ فشل في إرسال الرسالة", details: error.message });
    }
});

// تشغيل السيرفر
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 السيرفر يعمل على البورت ${PORT}`);
});

client.initialize();
