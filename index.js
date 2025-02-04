const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');
const fs = require('fs-extra');
const { google } = require('googleapis');

const app = express();
app.use(express.json());

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const FOLDER_ID = '1EREBW5S6FB4qizTyBW18Vcgxkeg80TbJ';

const auth = new google.auth.GoogleAuth({
    keyFile: 'momo.json',
    scopes: SCOPES,
});

const drive = google.drive({ version: 'v3', auth });

// تغيير مسار الجلسة ليتوافق مع المجلد الذي يستخدمه LocalAuth
const SESSION_DIR = './sessions';
const SESSION_FILE_PATH = `${SESSION_DIR}/session.json`;

let client;
let qrCodeImageUrl = null;

async function downloadSession() {
    try {
        // إنشاء المجلد إذا لم يكن موجوداً
        await fs.ensureDir(SESSION_DIR);
        
        if (fs.existsSync(SESSION_FILE_PATH)) {
            console.log('✅ الجلسة موجودة محليًا.');
            return;
        }

        const response = await drive.files.list({
            q: `'${FOLDER_ID}' in parents and name='session.json'`,
            fields: 'files(id, name)',
        });

        if (response.data.files.length > 0) {
            const fileId = response.data.files[0].id;
            const dest = fs.createWriteStream(SESSION_FILE_PATH);
            await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' })
                .then(res => {
                    return new Promise((resolve, reject) => {
                        res.data
                            .pipe(dest)
                            .on('finish', resolve)
                            .on('error', reject);
                    });
                });
            console.log('✅ تم استعادة الجلسة من Google Drive.');
        } else {
            console.log('⚠️ لا يوجد ملف جلسة محفوظ، سيتم إنشاء جلسة جديدة.');
        }
    } catch (error) {
        console.error('❌ فشل استعادة الجلسة:', error.message);
    }
}

async function uploadSession() {
    try {
        // التأكد من وجود الملف قبل المحاولة لرفعه
        if (!fs.existsSync(SESSION_FILE_PATH)) {
            console.log('⚠️ ملف الجلسة غير موجود للرفع.');
            return;
        }

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

async function startWhatsApp() {
    await downloadSession();

    client = new Client({
        authStrategy: new LocalAuth({
            clientId: 'whatsapp-client', // إضافة معرف ثابت للعميل
            dataPath: SESSION_DIR
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

    client.on('authenticated', async (session) => {
        console.log('✅ مصادقة ناجحة! يتم حفظ الجلسة الآن في Google Drive...');
        // إضافة تأخير قصير للتأكد من حفظ الملفات
        setTimeout(async () => {
            await uploadSession();
        }, 1000);
    });

    client.on('ready', () => {
        console.log('✅ WhatsApp Client is Ready!');
    });

    client.initialize();
}

startWhatsApp();

app.get('/qrcode', (req, res) => {
    if (!qrCodeImageUrl) {
        return res.status(404).json({ success: false, error: "QR Code غير متاح حاليًا" });
    }
    res.send(`<img src="${qrCodeImageUrl}" alt="QR Code" />`);
});

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

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});
