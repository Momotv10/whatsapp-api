const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');
const fs = require('fs-extra');
const { google } = require('googleapis');

const app = express();
app.use(express.json());

// 🔹 إعداد Google Drive API
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const FOLDER_ID = '1EREBW5S6FB4qizTyBW18Vcgxkeg80TbJ'; // Folder ID الخاص بك

const auth = new google.auth.GoogleAuth({
    keyFile: 'idyllic-lotus-449820-h0-3b816a5af469.json', // ملف JSON الخاص بك
    scopes: SCOPES,
});

const drive = google.drive({ version: 'v3', auth });

const SESSION_FILE_PATH = './session.json';

let client;
let qrCodeImageUrl = null;

// 🔹 استعادة الجلسة من Google Drive عند بدء التشغيل
async function downloadSession() {
    try {
        const response = await drive.files.list({
            q: `'${FOLDER_ID}' in parents and name='session.json'`,
            fields: 'files(id, name)',
        });

        if (response.data.files.length > 0) {
            const fileId = response.data.files[0].id;
            const dest = fs.createWriteStream(SESSION_FILE_PATH);
            await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' })
                .then(res => res.data.pipe(dest));
            console.log('✅ جلسة WhatsApp تم استعادتها من Google Drive.');
        } else {
            console.log('⚠️ لا يوجد ملف جلسة محفوظ، سيتم إنشاء جلسة جديدة.');
        }
    } catch (error) {
        console.error('❌ فشل استعادة الجلسة:', error.message);
    }
}

// 🔹 حفظ الجلسة إلى Google Drive
async function uploadSession() {
    try {
        const response = await drive.files.list({
            q: `'${FOLDER_ID}' in parents and name='session.json'`,
            fields: 'files(id, name)',
        });

        if (response.data.files.length > 0) {
            const fileId = response.data.files[0].id;
            await drive.files.update({
                fileId,
                media: { body: fs.createReadStream(SESSION_FILE_PATH) },
            });
            console.log('✅ تم تحديث الجلسة في Google Drive.');
        } else {
            await drive.files.create({
                media: { body: fs.createReadStream(SESSION_FILE_PATH) },
                resource: { name: 'session.json', parents: [FOLDER_ID] },
            });
            console.log('✅ تم حفظ الجلسة الجديدة في Google Drive.');
        }
    } catch (error) {
        console.error('❌ فشل حفظ الجلسة:', error.message);
    }
}

// 🔹 تحميل الجلسة عند بدء التشغيل ثم تشغيل العميل
async function startWhatsApp() {
    await downloadSession();

    client = new Client({
        authStrategy: new LocalAuth({
            dataPath: 'sessions'
        }),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    client.on('qr', async (qr) => {
        console.log("✅ QR Code Generated");
        qrCodeImageUrl = await qrcode.toDataURL(qr);
    });

    client.on('authenticated', async () => {
        console.log('✅ مصادقة ناجحة! يتم حفظ الجلسة الآن في Google Drive...');
        await uploadSession();
    });

    client.on('ready', () => {
        console.log('✅ WhatsApp Client is Ready!');
    });

    client.initialize();
}

// 🔹 تشغيل الوظائف
startWhatsApp();

// 🔹 API للحصول على QR Code كصورة
app.get('/qrcode', (req, res) => {
    if (!qrCodeImageUrl) {
        return res.status(404).json({ success: false, error: "QR Code غير متاح حاليًا" });
    }
    res.send(`<img src="${qrCodeImageUrl}" alt="QR Code" />`);
});

// 🔹 API لإرسال رسالة
app.post('/send', async (req, res) => {
    const { phone, message } = req.body;
    if (!phone || !message) {
        return res.status(400).json({ success: false, error: "رقم الهاتف والرسالة مطلوبان!" });
    }
    try {
        await client.sendMessage(`${phone}@c.us`, message);
        res.json({ success: true, message: "✅ تم إرسال الرسالة!" });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 🔹 تشغيل السيرفر
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});
