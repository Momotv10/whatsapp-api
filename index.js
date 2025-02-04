const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');
const fs = require('fs-extra');
const { google } = require('googleapis');
const path = require('path');

const app = express();
app.use(express.json());

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const FOLDER_ID = '1EREBW5S6FB4qizTyBW18Vcgxkeg80TbJ';

const auth = new google.auth.GoogleAuth({
    keyFile: 'https://firebasestorage.googleapis.com/v0/b/momopay-12ca0.appspot.com/o/idyllic-lotus-449820-h0-0681609b2802.json?alt=media&token=3de7563a-7cb0-4a89-8e24-0f41d14df45e',
    scopes: SCOPES,
});

const drive = google.drive({ version: 'v3', auth });

// تعديل مسارات الجلسة
const SESSION_DIR = './momopay';
const MULTI_DEVICE_DIR = path.join(SESSION_DIR, 'session-client-one', 'Default');

let client;
let qrCodeImageUrl = null;
let sessionCheckInterval;

// وظيفة للتأكد من وجود الملفات
async function waitForSessionFiles(maxAttempts = 10) {
    for (let i = 0; i < maxAttempts; i++) {
        if (fs.existsSync(MULTI_DEVICE_DIR)) {
            const files = await fs.readdir(MULTI_DEVICE_DIR);
            if (files.length > 0) {
                return true;
            }
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return false;
}

// وظيفة لإنشاء المجلدات الضرورية
async function createRequiredDirectories() {
    await fs.ensureDir(SESSION_DIR);
    await fs.ensureDir(MULTI_DEVICE_DIR);
    console.log('✅ تم إنشاء المجلدات المطلوبة');
}

async function uploadSession() {
    try {
        // انتظار وجود ملفات الجلسة
        const filesExist = await waitForSessionFiles();
        if (!filesExist) {
            console.log('⚠️ لم يتم العثور على ملفات الجلسة بعد');
            return;
        }

        // قراءة جميع الملفات في المجلد
        const files = await fs.readdir(MULTI_DEVICE_DIR);
        if (files.length === 0) {
            console.log('⚠️ المجلد فارغ، لا توجد ملفات للرفع');
            return;
        }

        // حذف الملفات القديمة من Drive
        const existingFiles = await drive.files.list({
            q: `'${FOLDER_ID}' in parents`,
            fields: 'files(id, name)',
        });

        for (const file of existingFiles.data.files) {
            await drive.files.delete({ fileId: file.id });
        }

        // رفع الملفات الجديدة
        for (const file of files) {
            const filePath = path.join(MULTI_DEVICE_DIR, file);
            const fileStats = await fs.stat(filePath);
            
            if (fileStats.isFile()) {
                await drive.files.create({
                    requestBody: {
                        name: file,
                        parents: [FOLDER_ID]
                    },
                    media: {
                        body: fs.createReadStream(filePath)
                    }
                });
                console.log(`✅ تم رفع الملف: ${file}`);
            }
        }
        
        console.log('✅ تم حفظ جميع ملفات الجلسة في Google Drive');
    } catch (error) {
        console.error('❌ خطأ في رفع الجلسة:', error.message);
    }
}

async function downloadSession() {
    try {
        await createRequiredDirectories();

        const response = await drive.files.list({
            q: `'${FOLDER_ID}' in parents`,
            fields: 'files(id, name)',
        });

        if (response.data.files.length > 0) {
            for (const file of response.data.files) {
                const destPath = path.join(MULTI_DEVICE_DIR, file.name);
                const dest = fs.createWriteStream(destPath);
                
                await drive.files.get(
                    { fileId: file.id, alt: 'media' },
                    { responseType: 'stream' }
                ).then(res => {
                    return new Promise((resolve, reject) => {
                        res.data
                            .pipe(dest)
                            .on('finish', resolve)
                            .on('error', reject);
                    });
                });
            }
            console.log('✅ تم استعادة الجلسة من Google Drive');
        } else {
            console.log('⚠️ لا توجد ملفات جلسة في Google Drive');
        }
    } catch (error) {
        console.error('❌ خطأ في تنزيل الجلسة:', error.message);
    }
}

function startSessionAutoSave() {
    sessionCheckInterval = setInterval(async () => {
        if (client && client.pupPage) {
            await uploadSession();
        }
    }, 60000); // كل دقيقة
}

async function startWhatsApp() {
    await downloadSession();

    client = new Client({
        authStrategy: new LocalAuth({
            clientId: 'client-one',
            dataPath: SESSION_DIR
        }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu'
            ]
        }
    });

    client.on('qr', async (qr) => {
        console.log("✅ تم إنشاء رمز QR جديد");
        qrCodeImageUrl = await qrcode.toDataURL(qr);
    });

    client.on('authenticated', async () => {
        console.log('✅ تمت المصادقة بنجاح!');
        // انتظار لحظة للتأكد من حفظ الملفات
        setTimeout(async () => {
            await uploadSession();
            startSessionAutoSave();
        }, 5000);
    });

    client.on('ready', () => {
        console.log('✅ WhatsApp جاهز للاستخدام!');
    });

    client.on('disconnected', async () => {
        console.log('❌ تم قطع الاتصال');
        if (sessionCheckInterval) {
            clearInterval(sessionCheckInterval);
        }
        setTimeout(startWhatsApp, 5000);
    });

    await client.initialize();
}

// بقية الكود (routes) كما هو
app.get('/qrcode', (req, res) => {
    if (!qrCodeImageUrl) {
        return res.status(404).json({ success: false, error: "QR Code غير متاح حالياً" });
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

process.on('SIGTERM', async () => {
    if (sessionCheckInterval) {
        clearInterval(sessionCheckInterval);
    }
    if (client) {
        await uploadSession();
        await client.destroy();
    }
    process.exit(0);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 السيرفر يعمل على المنفذ ${PORT}`);
});

// بدء التطبيق
startWhatsApp();
