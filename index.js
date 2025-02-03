const { Client, RemoteAuth } = require('whatsapp-web.js');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const express = require('express');
const qrcode = require('qrcode');

// تحميل بيانات حساب الخدمة
const KEYFILEPATH = path.join(__dirname, 'idyllic-lotus-449820-h0-3b816a5af469.json'); // مسار ملف JSON لحساب الخدمة
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

// إعداد Google Drive API
const auth = new google.auth.GoogleAuth({
    keyFile: KEYFILEPATH,
    scopes: SCOPES,
});

const drive = google.drive({ version: 'v3', auth });

// إنشاء تطبيق Express
const app = express();
app.use(express.json());

// إنشاء العميل
const client = new Client({
    authStrategy: new RemoteAuth({
        clientId: "1EREBW5S6FB4qizTyBW18Vcgxkeg80TbJ", // استبدلها بـ Client ID الخاص بحساب Google API
        backupSyncIntervalMs: 300000,
    }),
    puppeteer: {
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// متغير لتخزين QR Code كصورة
let qrCodeImageUrl = null;

// 🔹 إظهار QR Code كصورة
client.on('qr', async (qr) => {
    console.log('🔹 امسح الـ QR Code لتسجيل الدخول');

    // إنشاء QR Code كصورة
    qrCodeImageUrl = await qrcode.toDataURL(qr);
    console.log('✅ QR Code image generated. Use the following URL to scan:');
    console.log(qrCodeImageUrl); // هذا هو رابط الصورة
});

// ✅ حفظ الجلسة بعد تسجيل الدخول
client.on('authenticated', async () => {
    console.log('✅ تم تسجيل الدخول بنجاح، سيتم حفظ الجلسة...');
    await saveSession();
});

// 🔹 تحميل الجلسة من Google Drive
async function loadSession() {
    try {
        const response = await drive.files.list({
            q: "name='session.json'",
            fields: 'files(id, name)',
        });

        if (response.data.files.length > 0) {
            const fileId = response.data.files[0].id;
            const filePath = path.join(__dirname, 'session.json');

            const dest = fs.createWriteStream(filePath);
            await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' })
                .then(res => {
                    res.data.pipe(dest);
                });

            console.log('✅ تم تحميل الجلسة من Google Drive');
        } else {
            console.log('⚠️ لا يوجد ملف جلسة محفوظ.');
        }
    } catch (error) {
        console.error('❌ فشل تحميل الجلسة:', error);
    }
}

// 🔹 حفظ الجلسة إلى Google Drive
async function saveSession() {
    try {
        const filePath = path.join(__dirname, 'session.json');
        if (!fs.existsSync(filePath)) {
            console.log('⚠️ لم يتم العثور على ملف الجلسة، سيتم إنشاؤه بعد تسجيل الدخول.');
            return;
        }

        const fileMetadata = {
            name: 'session.json',
            mimeType: 'application/json',
        };

        const media = {
            mimeType: 'application/json',
            body: fs.createReadStream(filePath),
        };

        await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id',
        });

        console.log('✅ تم حفظ الجلسة إلى Google Drive');
    } catch (error) {
        console.error('❌ فشل حفظ الجلسة:', error);
    }
}

// 🔹 عند فقدان الاتصال، احفظ الجلسة
client.on('disconnected', async () => {
    console.log('⚠️ تم فقدان الاتصال، سيتم حفظ الجلسة...');
    await saveSession();
});

// 🚀 API لعرض QR Code كصورة
app.get('/qrcode', (req, res) => {
    if (!qrCodeImageUrl) {
        return res.status(404).json({ success: false, error: "QR Code not generated yet." });
    }
    res.send(`<img src="${qrCodeImageUrl}" alt="QR Code" />`);
});

// 🚀 تشغيل السيرفر
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});

// 🚀 تشغيل العميل
client.initialize();
loadSession();
