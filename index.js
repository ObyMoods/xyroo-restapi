const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');
const { MongoClient } = require('mongodb');
const FormData = require('form-data');
const os = require('os');
const path = require('path');
const JsConfuser = require('js-confuser');
const fileUpload = require('express-fileupload');
const yts = require('yt-search');
const axios = require('axios');
const cheerio = require('cheerio');
const { decode } = require('html-entities');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');
const input = require('input');

const app = express();
const MONGODB_URI = "mongodb+srv://fanzmmq_db_user:ucfIEGy1YxyYWWjQ@db-restapi.ljy5pzb.mongodb.net/yakuza_api?retryWrites=true&w=majority";
const MONGODB_DB = "db-restapi";
let mongoClient;
let mongoDb;
let databaseDocId = 'main';

async function getMongoDb() {
    if (!MONGODB_URI) throw new Error('MONGODB_URI belum diatur di Environment Variables.');
    if (mongoDb) return mongoDb;
    mongoClient = new MongoClient(MONGODB_URI, { maxPoolSize: 10, minPoolSize: 0 });
    await mongoClient.connect();
    mongoDb = mongoClient.db(MONGODB_DB);
    await mongoDb.collection('appdata').createIndex({ _id: 1 }, { unique: true });
    return mongoDb;
}
const AUTHOR = "Xyroo Api's";

app.use(cors({
    origin: 'https://restapixyroofree.vercel.app',
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static('views'));
app.use(fileUpload({
    limits: { fileSize: 50 * 1024 * 1024 },
    abortOnLimit: true,
    createParentPath: true
}));

async function readDatabase() {
    const db = await getMongoDb();
    const collection = db.collection('appdata');
    let doc = await collection.findOne({ _id: databaseDocId });
    if (!doc) {
        doc = { _id: databaseDocId, users: [], total_requests: 0, total_users: 0 };
        await collection.insertOne(doc);
    }
    return doc;
}

async function writeDatabase(data) {
    const db = await getMongoDb();
    const { _id, ...payload } = data;
    await db.collection('appdata').replaceOne(
        { _id: databaseDocId },
        { _id: databaseDocId, ...payload },
        { upsert: true }
    );
}

function generateApiKey() {
    const prefix = 'Xyroo';
    const random = uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase();
    const timestamp = Date.now().toString(36).toUpperCase();
    return `${prefix}-${random}`;
}

function verifyToken(req, res, next) {
    const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({
            status: false,
            code: 401,
            message: 'Silahkan login terlebih dahulu'
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(403).json({
            status: false,
            code: 403,
            message: 'Token tidak valid atau expired'
        });
    }
}

async function validateApiKey(req, res, next) {
    try {
        const apikey = req.query.apikey || req.body.apikey;
        const db = await readDatabase();
        if (!apikey) return res.status(401).json({ status:false, code:401, message:'API Key diperlukan! Gunakan parameter apikey' });
        const user = db.users.find(u => u.apikey === apikey);
        if (!user) return res.status(403).json({ status:false, code:403, message:'API Key tidak valid!' });
        if (user.status !== 'active') return res.status(403).json({ status:false, code:403, message:'Akun Anda tidak aktif! Hubungi admin.' });
        if (user.hit >= user.limit) return res.status(429).json({ status:false, code:429, message:'Limit penggunaan Anda telah habis! Hubungi admin untuk upgrade.' });
        user.hit += 2;
        db.total_requests += 2;
        await writeDatabase(db);
        req.user = user;
        next();
    } catch (error) {
        console.error('[MongoDB validateApiKey Error]:', error);
        return res.status(500).json({ status:false, code:500, message:'Database error', error:error.message });
    }
}

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

app.get('/', (req, res) => {
    const token = req.cookies.token;
    if (token) {
        try {
            jwt.verify(token, process.env.JWT_SECRET);
            res.sendFile(path.join(__dirname, 'views', 'index.html'));
        } catch (error) {
            res.sendFile(path.join(__dirname, 'views', 'login.html'));
        }
    } else {
        res.sendFile(path.join(__dirname, 'views', 'login.html'));
    }
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'register.html'));
});

app.get('/dashboard', verifyToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const db = await readDatabase();
        
        if (!username || !email || !password) {
            return res.status(400).json({
                status: false,
                code: 400,
                message: 'Semua field (username, email, password) harus diisi!'
            });
        }
        
        const existingUser = db.users.find(u => u.email === email);
        if (existingUser) {
            return res.status(400).json({
                status: false,
                code: 400,
                message: 'Email sudah terdaftar!'
            });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        let apiKey;
        let isUnique = false;
        while (!isUnique) {
            apiKey = generateApiKey();
            isUnique = !db.users.some(u => u.apikey === apiKey);
        }
        
        const newUser = {
            id: uuidv4(),
            username,
            email,
            password: hashedPassword,
            apikey: apiKey,
            hit: 0,
            limit: 100,
            role: 'REGULAR',
            status: "active",
            created_at: new Date().toISOString(),
            last_login: null,
            updated_at: null,
            expired_at: null,
            endpoint_hits: {}
        };
        
        db.users.push(newUser);
        db.total_users += 1;
        await writeDatabase(db);
        
        const token = jwt.sign(
            { id: newUser.id, username: newUser.username, email: newUser.email },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        res.cookie('token', token, {
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            sameSite: 'strict'
        });
        
        res.json({
            status: true,
            code: 200,
            message: 'Registrasi berhasil!',
            data: {
                username: newUser.username,
                email: newUser.email,
                apikey: newUser.apikey,
                limit: newUser.limit
            }
        });
        
    } catch (error) {
        res.status(500).json({
            status: false,
            code: 500,
            message: error.message
        });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const db = await readDatabase();
        
        if (!email || !password) {
            return res.status(400).json({
                status: false,
                code: 400,
                message: 'Email dan password harus diisi!'
            });
        }
        
        const user = db.users.find(u => u.email === email);
        
        if (!user) {
            return res.status(401).json({
                status: false,
                code: 401,
                message: 'Email atau password salah!'
            });
        }
        
        const validPassword = await bcrypt.compare(password, user.password);
        
        if (!validPassword) {
            return res.status(401).json({
                status: false,
                code: 401,
                message: 'Email atau password salah!'
            });
        }
        
        user.last_login = new Date().toISOString();
        user.updated_at = new Date().toISOString();
        await writeDatabase(db);
        
        const token = jwt.sign(
            { id: user.id, username: user.username, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        res.cookie('token', token, {
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            sameSite: 'strict'
        });
        
        res.json({
            status: true,
            code: 200,
            message: 'Login berhasil!',
            data: {
                username: user.username,
                email: user.email,
                apikey: user.apikey,
                hit: user.hit,
                limit: user.limit,
                remaining: user.limit - user.hit
            }
        });
        
    } catch (error) {
        res.status(500).json({
            status: false,
            code: 500,
            message: error.message
        });
    }
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('token');
    res.json({
        status: true,
        code: 200,
        message: 'Logout berhasil!'
    });
});

app.get('/api/user/me', verifyToken, async (req, res) => {
    const db = await readDatabase();
    const user = db.users.find(u => u.id === req.user.id);
    
    if (!user) {
        return res.status(404).json({
            status: false,
            code: 404,
            message: 'User tidak ditemukan'
        });
    }
    
    res.json({
        status: true,
        code: 200,
        data: {
            id: user.id,
            username: user.username,
            email: user.email,
            apikey: user.apikey,
            hit: user.hit,
            limit: user.limit,
            remaining: user.limit - user.hit,
            status: user.status,
            created_at: user.created_at,
            last_login: user.last_login
        }
    });
});

app.post('/api/user/regenerate-key', verifyToken, async (req, res) => {
    try {
        const db = await readDatabase();
        const userIndex = db.users.findIndex(u => u.id === req.user.id);
        
        if (userIndex === -1) {
            return res.status(404).json({
                status: false,
                code: 404,
                message: 'User tidak ditemukan'
            });
        }
        
        let newApiKey;
        let isUnique = false;
        while (!isUnique) {
            newApiKey = generateApiKey();
            isUnique = !db.users.some(u => u.apikey === newApiKey);
        }
        
        db.users[userIndex].apikey = newApiKey;
        await writeDatabase(db);
        
        res.json({
            status: true,
            code: 200,
            message: 'API Key berhasil digenerate ulang!',
            data: {
                apikey: newApiKey
            }
        });
        
    } catch (error) {
        res.status(500).json({
            status: false,
            code: 500,
            message: error.message
        });
    }
});

function parseInstagramHTML(html) {
    if (!html) throw new Error("HTML kosong!");
    const $ = cheerio.load(html);
  
    const result = {
        username: null,
        name: null,
        caption: null,
        likes: null,
        comments: null,
        time: null,
        videoUrl: null,
        imageUrl: null,
        downloadLink: null,
        media: [],
    };
  
    result.username = decode($("#user_info p.h4").first().text().trim() || $("p.h4").first().text().trim() || null);
    result.name = decode($("#user_info p.text-muted").first().text().trim() || null);
  
    const captionElement = $(".d-flex.justify-content-between.align-items-center p.text-sm").first();
    if (captionElement.length) {
        const rawCaption = captionElement.html() || captionElement.text();
        result.caption = decode(rawCaption.replace(/<br\s*\/?>/gi, "\n").trim());
    }
  
    const stats = $(".stats.text-sm small");
    result.likes = stats.eq(0).text().trim() || null;
    result.comments = stats.eq(1).text().trim() || null;
    result.time = stats.eq(2).text().trim() || null;
  
    const videoTag = $("video source");
    const videoUrl = videoTag.attr("src");
    const imgPoster = $("video").attr("poster") || $("img.rounded-circle").attr("src");
    const downloadLink = $("a.btn.bg-gradient-success").attr("href");
  
    result.videoUrl = videoUrl ? cleanUrl(videoUrl) : null;
    result.imageUrl = imgPoster ? cleanUrl(imgPoster) : null;
    result.downloadLink = downloadLink ? cleanUrl(downloadLink) : null;
  
    const urls = [];
    const regex = /(https?:\/\/[^\s"']+\.(?:mp4|jpg|jpeg|png|webp))/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        urls.push(cleanUrl(match[1]));
    }
  
    result.media = Array.from(new Set(urls));
  
    return result;
}

function cleanUrl(url) {
    try {
        if (!url) return null;
        const decoded = decodeURIComponent(url);
        const u = new URL(decoded);
        u.searchParams.delete("ccb");
        u.searchParams.delete("oh");
        u.searchParams.delete("oe");
        u.searchParams.delete("edm");
        u.searchParams.delete("_nc_ht");
        return u.toString();
    } catch {
        return url;
    }
}

async function instagramDownloader(instagramUrl) {
    if (!instagramUrl) throw new Error("URL Instagram wajib diisi!");
    const encodedUrl = encodeURIComponent(instagramUrl);
    const target = `https://igram.website/content.php?url=${encodedUrl}`;
  
    const headers = {
        "accept": "*/*",
        "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
        "cache-control": "no-cache",
        "content-type": "application/x-www-form-urlencoded",
        "pragma": "no-cache",
        "sec-ch-ua": `"Chromium";v="139", "Not;A=Brand";v="99"`,
        "sec-ch-ua-mobile": "?1",
        "sec-ch-ua-platform": `"Android"`,
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "Referer": "https://igram.website/",
        "Referrer-Policy": "strict-origin-when-cross-origin",
    };
  
    try {
        const response = await fetch(target, { method: "GET", headers });
        if (!response.ok) throw new Error(`Request gagal: ${response.status} ${response.statusText}`);
  
        const data = await response.json();
        const html = data.html;
        const parsed = parseInstagramHTML(html);
  
        return parsed;
    } catch (error) {
        return { status: "error", message: error.message };
    }
}

app.get('/api/instagram', validateApiKey, async (req, res) => {
    try {
        const { url } = req.query;
        
        if (!url) {
            return res.status(400).json({
                status: false,
                code: 400,
                author: AUTHOR,
                message: 'Parameter "url" diperlukan!'
            });
        }

        console.log(`[Instagram Downloader] Request from ${req.user.username}: ${url}`);

        const result = await instagramDownloader(url);

        if (result.status === 'error') {
            return res.status(500).json({
                status: false,
                code: 500,
                author: AUTHOR,
                message: result.message
            });
        }

        res.json({
            status: true,
            code: 200,
            author: AUTHOR,
            data: result
        });

    } catch (error) {
        console.error('[Instagram Downloader Error]:', error);
        res.status(500).json({
            status: false,
            code: 500,
            author: AUTHOR,
            message: 'Internal server error',
            error: error.message
        });
    }
});

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function getHeaders(url, cookieString = "") {
    const headers = {
        "user-agent": USER_AGENT,
        "referer": url,
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "connection": "keep-alive",
    };
    if (cookieString) headers["cookie"] = cookieString;
    return headers;
}

function parseCookies(response) {
    const setCookieHeader = response.headers.get("set-cookie");
    if (!setCookieHeader) return "";
  
    if (response.headers.getSetCookie) {
        return response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    }
  
    const rawCookies = setCookieHeader.split(/,(?=\s*[a-zA-Z0-9_\-]+=)/);
    return rawCookies.map(c => c.split(';')[0]).join('; ');
}

async function fetchPage(url, cookieString = "") {
    try {
        const response = await fetch(url, {
            method: "GET",
            headers: getHeaders(url, cookieString)
        });
  
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
  
        const html = await response.text();
        const newCookies = parseCookies(response);
  
        return { success: true, html, cookies: newCookies };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

function extractFinalDownloadUrl(html) {
    const $ = cheerio.load(html);
    const scripts = $("script").map((_, el) => $(el).html()).get().join("\n");
    const regex = /https:\\\/\\\/download\d+\.sfile\.co\\\/downloadfile\\\/[^"\s]+/i;
    const match = scripts.match(regex);
    if (!match) return null;
    return match[0].replace(/\\\//g, "/");
}

function parseFileMetadata(html) {
    const $ = cheerio.load(html);
  
    const safeText = (selector) => $(selector).first().text().trim();
    const safeAttr = (selector, attr) => $(selector).first().attr(attr) || "";
  
    const title = safeText('h1.text-white');
  
    let uploader = safeText('a[href*="/user/"]');
    if (!uploader) uploader = "Unknown";
  
    let category = safeText('a[href*="/category/"]');
    if (!category) category = "Unknown";
  
    const dateText = safeText('span:contains("Uploaded:")');
    const uploadedDate = dateText.replace('Uploaded:', '').trim();
  
    const intermediateLink = safeAttr('#download', 'href');
  
    let size = "Unknown";
    const metaDesc = safeAttr('meta[name="description"]', "content");
    if (metaDesc) {
        const sizeMatch = metaDesc.match(/size\s+([\d.]+\s+\w+)/i);
        if (sizeMatch) size = sizeMatch[1];
    }
  
    return { title, uploader, category, uploadedDate, intermediateLink, size };
}

async function scrapeSfile(url) {
    try {
        if (/download/i.test(url)) {
            return {
                status: false,
                author: AUTHOR,
                message: "Invalid URL: Mohon masukkan URL halaman file (sfile.co/...), bukan link download langsung."
            };
        }
  
        const firstPage = await fetchPage(url);
        if (!firstPage.success) throw new Error("Gagal mengambil halaman utama: " + firstPage.error);
  
        const meta = parseFileMetadata(firstPage.html);
        if (!meta.intermediateLink) {
            return {
                status: false,
                author: AUTHOR,
                message: "Tombol download tidak ditemukan pada halaman."
            };
        }
  
        const secondPage = await fetchPage(meta.intermediateLink, firstPage.cookies);
        if (!secondPage.success) throw new Error("Gagal mengambil halaman download: " + secondPage.error);
  
        const finalUrl = extractFinalDownloadUrl(secondPage.html);
        if (!finalUrl) {
            return {
                status: false,
                author: AUTHOR,
                message: "Gagal menemukan URL akhir (mungkin server sedang sibuk atau struktur berubah)."
            };
        }
  
        return {
            status: true,
            author: AUTHOR,
            data: {
                title: meta.title,
                size: meta.size,
                creator: meta.uploader,
                category: meta.category,
                upload_date: meta.uploadedDate,
                downloadUrl: finalUrl
            }
        };
  
    } catch (error) {
        console.error("Scrape Error:", error);
        return {
            status: false,
            author: AUTHOR,
            message: error.message || "Terjadi kesalahan tak terduga."
        };
    }
}

app.get('/api/sfile', validateApiKey, async (req, res) => {
    try {
        const { url } = req.query;
        
        if (!url) {
            return res.status(400).json({
                status: false,
                code: 400,
                author: AUTHOR,
                message: 'Parameter "url" diperlukan!'
            });
        }

        console.log(`[Sfile Downloader] Request from ${req.user.username}: ${url}`);

        const result = await scrapeSfile(url);

        if (!result.status) {
            return res.status(400).json({
                status: false,
                code: 400,
                author: AUTHOR,
                message: result.message
            });
        }

        res.json({
            status: true,
            code: 200,
            author: AUTHOR,
            data: result.data
        });

    } catch (error) {
        console.error('[Sfile Downloader Error]:', error);
        res.status(500).json({
            status: false,
            code: 500,
            author: AUTHOR,
            message: 'Internal server error',
            error: error.message
        });
    }
});

async function ytdlmp3(link) {
    try {
        const encodedUrl = encodeURIComponent(link);

        const { data } = await axios.get(
            `https://p.savenow.to/ajax/download.php?copyright=0&format=mp3&url=${encodedUrl}&api=dfcb6d76f2f6a9894gjkege8a4ab232222`,
            {
                headers: {
                    "accept": "application/json",
                    "user-agent": "Mozilla/5.0"
                }
            }
        );

        if (!data.success) {
            throw new Error("Gagal memulai proses download");
        }

        const progressUrl = data.progress_url;
        if (!progressUrl) {
            throw new Error("Progress URL tidak ditemukan");
        }

        let downloadData;
        let attempt = 0;

        while (attempt < 20) {
            const res = await axios.get(progressUrl, {
                headers: {
                    "accept": "application/json",
                    "user-agent": "Mozilla/5.0"
                }
            });

            if (res.data.download_url) {
                downloadData = res.data;
                break;
            }

            await new Promise(resolve => setTimeout(resolve, 2000));
            attempt++;
        }

        if (!downloadData) {
            throw new Error("Timeout menunggu download selesai");
        }

        return {
            title: data.title,
            thumbnail: data.info?.image,
            download: downloadData.download_url,
            alternative: downloadData.alternative_download_urls
        };

    } catch (err) {
        throw new Error(`Error: ${err.message}`);
    }
}

app.get('/api/ytmp3', validateApiKey, async (req, res) => {
    try {
        const { url } = req.query;
        
        if (!url) {
            return res.status(400).json({
                status: false,
                code: 400,
                author: AUTHOR,
                message: 'Parameter "url" diperlukan!'
            });
        }

        if (!url.includes('youtube.com/watch') && !url.includes('youtu.be/') && !url.includes('youtube.com/shorts/')) {
            return res.status(400).json({
                status: false,
                code: 400,
                author: AUTHOR,
                message: 'URL tidak valid! Harus URL YouTube (youtube.com/watch, youtu.be/, atau youtube.com/shorts/)'
            });
        }

        console.log(`[YTDL MP3] Request from ${req.user.username}: ${url}`);

        const result = await ytdlmp3(url);

        res.json({
            status: true,
            code: 200,
            author: AUTHOR,
            data: {
                title: result.title,
                thumbnail: result.thumbnail,
                download: result.download,
                alternative: result.alternative
            }
        });

    } catch (error) {
        console.error('[YTDL MP3 Error]:', error);
        res.status(500).json({
            status: false,
            code: 500,
            author: AUTHOR,
            message: error.message || 'Internal server error'
        });
    }
});

async function ytdlmp4(link, quality = 720) {
    try {
        const encodedUrl = encodeURIComponent(link);

        const { data } = await axios.get(
            `https://p.savenow.to/ajax/download.php?copyright=0&format=${quality}&url=${encodedUrl}&api=dfcb6d76f2f6a9894gjkege8a4ab232222`,
            {
                headers: {
                    "accept": "application/json",
                    "user-agent": "Mozilla/5.0"
                }
            }
        );

        if (!data.success) {
            throw new Error("Gagal memulai proses download");
        }

        if (!data.progress_url) {
            throw new Error("Progress URL tidak ditemukan");
        }

        let result = null;
        let attempt = 0;

        while (attempt < 25) {
            const res = await axios.get(data.progress_url, {
                headers: {
                    "accept": "application/json",
                    "user-agent": "Mozilla/5.0"
                }
            });

            if (res.data?.download_url) {
                result = res.data;
                break;
            }

            await new Promise(r => setTimeout(r, 2000));
            attempt++;
        }

        if (!result) {
            throw new Error("Timeout menunggu proses convert");
        }

        return {
            title: data.title,
            thumbnail: data.info?.image,
            quality: quality + "p",
            download: result.download_url,
            alternative: result.alternative_download_urls
        };

    } catch (err) {
        throw new Error("Error ytdlmp4: " + err.message);
    }
}

app.get('/api/ytmp4', validateApiKey, async (req, res) => {
    try {
        const { url, quality = 720 } = req.query;
        
        if (!url) {
            return res.status(400).json({
                status: false,
                code: 400,
                author: AUTHOR,
                message: 'Parameter "url" diperlukan!'
            });
        }

        if (!url.includes('youtube.com/watch') && !url.includes('youtu.be/') && !url.includes('youtube.com/shorts/')) {
            return res.status(400).json({
                status: false,
                code: 400,
                author: AUTHOR,
                message: 'URL tidak valid! Harus URL YouTube (youtube.com/watch, youtu.be/, atau youtube.com/shorts/)'
            });
        }

        const validQualities = [360, 480, 720, 1080];
        const selectedQuality = parseInt(quality);
        
        if (!validQualities.includes(selectedQuality)) {
            return res.status(400).json({
                status: false,
                code: 400,
                author: AUTHOR,
                message: 'Kualitas tidak valid! Pilih: 360, 480, 720, atau 1080'
            });
        }

        console.log(`[YTDL MP4] Request from ${req.user.username}: ${url} (${selectedQuality}p)`);

        const result = await ytdlmp4(url, selectedQuality);

        res.json({
            status: true,
            code: 200,
            author: AUTHOR,
            data: {
                title: result.title,
                thumbnail: result.thumbnail,
                quality: result.quality,
                download: result.download,
                alternative: result.alternative
            }
        });

    } catch (error) {
        console.error('[YTDL MP4 Error]:', error);
        res.status(500).json({
            status: false,
            code: 500,
            author: AUTHOR,
            message: error.message || 'Internal server error'
        });
    }
});

const SPOTIFY_CLIENT_ID = "501054a922b747c0ad87d028e1ede74d";
const SPOTIFY_CLIENT_SECRET = "14a71c6c29c442bba0f834d01858bbf2";

async function getSpotifyToken() {
    try {
        const response = await axios({
            method: 'post',
            url: 'https://accounts.spotify.com/api/token',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64')
            },
            data: 'grant_type=client_credentials'
        });
        
        return response.data.access_token;
    } catch (error) {
        console.error('[Spotify Token Error]', error.message);
        throw new Error('Gagal mendapatkan token Spotify');
    }
}

async function getSpotifyTrack(trackId) {
    try {
        const token = await getSpotifyToken();
        
        const response = await axios.get(`https://api.spotify.com/v1/tracks/${trackId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        return response.data;
    } catch (error) {
        console.error('[Spotify Track Error]', error.message);
        throw new Error('Gagal mendapatkan detail track');
    }
}

async function getSpotifyDownloadUrl(trackId) {
    try {
        const response = await axios.get(`https://api.spotify-downloader.com/download/${trackId}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 30000
        });
        
        return response.data;
    } catch (error) {
        console.error('[Spotify Download Error]', error.message);
        
        try {
            const fallbackResponse = await axios.get(`https://spotify-downloader9.p.rapidapi.com/downloadSong?songId=${trackId}`, {
                headers: {
                    'X-RapidAPI-Key': process.env.RAPIDAPI_KEY || 'YOUR_RAPIDAPI_KEY',
                    'X-RapidAPI-Host': 'spotify-downloader9.p.rapidapi.com'
                },
                timeout: 30000
            });
            
            return fallbackResponse.data;
        } catch (fallbackError) {
            throw new Error('Gagal mendapatkan link download');
        }
    }
}

app.get('/api/spotify-download', validateApiKey, async (req, res) => {
    try {
        const { url } = req.query;
        
        if (!url) {
            return res.status(400).json({
                status: false,
                code: 400,
                author: AUTHOR,
                message: 'Parameter "url" diperlukan!'
            });
        }

        console.log(`[Spotify Download] Request from ${req.user.username}: ${url}`);

        let trackId = '';
        
        const trackMatch = url.match(/track[\/:]([a-zA-Z0-9]+)/);
        if (trackMatch && trackMatch[1]) {
            trackId = trackMatch[1];
        } else {
            trackId = url;
        }

        if (!trackId) {
            return res.status(400).json({
                status: false,
                code: 400,
                author: AUTHOR,
                message: 'URL Spotify tidak valid!'
            });
        }

        const trackDetails = await getSpotifyTrack(trackId);

        let downloadData;
        try {
            downloadData = await getSpotifyDownloadUrl(trackId);
        } catch (downloadError) {
            return res.json({
                status: true,
                code: 200,
                author: AUTHOR,
                data: {
                    title: trackDetails.name,
                    artists: trackDetails.artists.map(a => a.name).join(', '),
                    album: trackDetails.album.name,
                    image_url: trackDetails.album.images[0]?.url || null,
                    duration: new Date(trackDetails.duration_ms).toISOString().slice(14, 19),
                    url: trackDetails.external_urls.spotify,
                    message: "Link download tidak tersedia saat ini"
                }
            });
        }

        res.json({
            status: true,
            code: 200,
            author: AUTHOR,
            data: {
                title: trackDetails.name,
                artists: trackDetails.artists.map(a => a.name).join(', '),
                album: trackDetails.album.name,
                image_url: trackDetails.album.images[0]?.url || null,
                duration: new Date(trackDetails.duration_ms).toISOString().slice(14, 19),
                url: trackDetails.external_urls.spotify,
                download_url: downloadData.download_url || downloadData.link || null,
                quality: downloadData.quality || '128kbps'
            }
        });

    } catch (error) {
        console.error('[Spotify Download Error]:', error);
        res.status(500).json({
            status: false,
            code: 500,
            author: AUTHOR,
            message: 'Internal server error',
            error: error.message
        });
    }
});

app.get('/api/spotify-download-id', validateApiKey, async (req, res) => {
    try {
        const { id } = req.query;
        
        if (!id) {
            return res.status(400).json({
                status: false,
                code: 400,
                author: AUTHOR,
                message: 'Parameter "id" diperlukan!'
            });
        }

        console.log(`[Spotify Download ID] Request from ${req.user.username}: ${id}`);

        const trackDetails = await getSpotifyTrack(id);

        res.json({
            status: true,
            code: 200,
            author: AUTHOR,
            data: {
                title: trackDetails.name,
                artists: trackDetails.artists.map(a => a.name).join(', '),
                album: trackDetails.album.name,
                image_url: trackDetails.album.images[0]?.url || null,
                duration: new Date(trackDetails.duration_ms).toISOString().slice(14, 19),
                url: trackDetails.external_urls.spotify
            }
        });

    } catch (error) {
        console.error('[Spotify Download ID Error]:', error);
        res.status(500).json({
            status: false,
            code: 500,
            author: AUTHOR,
            message: 'Internal server error',
            error: error.message
        });
    }
});

app.get('/api/tiktok-download', validateApiKey, async (req, res) => {
    try {
        const { url } = req.query;
        
        if (!url) {
            return res.status(400).json({
                status: false,
                code: 400,
                author: AUTHOR,
                message: 'Parameter "url" diperlukan!'
            });
        }

        console.log(`[TikTok Download] Request from ${req.user.username}: ${url}`);

        if (!url.includes('tiktok.com/')) {
            return res.status(400).json({
                status: false,
                code: 400,
                author: AUTHOR,
                message: 'URL tidak valid! Harus URL TikTok'
            });
        }

        const response = await axios.post(
            "https://www.tikwm.com/api/",
            `url=${encodeURIComponent(url)}`,
            {
                headers: { 
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" 
                },
                timeout: 30000
            }
        );
        
        const data = response.data;
        if (!data || data.code !== 0 || !data.data) {
            throw new Error("Video tidak ditemukan");
        }
        
        const vid = data.data;
        const videoUrl = vid.play || vid.hdplay || vid.wmplay || vid.play_addr;
        
        if (!videoUrl) {
            throw new Error("Tidak dapat menemukan URL video");
        }

        const isImage = vid.images && Array.isArray(vid.images) && vid.images.length > 0;

        const result = {
            title: vid.title || "Video TikTok",
            author: {
                id: vid.author?.unique_id || vid.author?.nickname || "unknown",
                nickname: vid.author?.nickname || vid.author?.unique_id || "Unknown",
                avatar: vid.author?.avatar || null
            },
            stats: {
                likes: vid.digg_count || 0,
                comments: vid.comment_count || 0,
                shares: vid.share_count || 0,
                plays: vid.play_count || 0
            },
            duration: vid.duration || 0,
            cover: vid.cover || null,
            original_url: url,
            is_image: isImage
        };

        if (isImage) {
            result.images = vid.images;
        } else {
            result.video_url = videoUrl;
            result.video_hd = vid.hdplay || null;
            result.video_wm = vid.wmplay || null;
        }

        res.json({
            status: true,
            code: 200,
            author: AUTHOR,
            data: result
        });

    } catch (error) {
        console.error('[TikTok Download Error]:', error);
        
        let errorMessage = 'Internal server error';
        if (error.response?.status === 404) {
            errorMessage = 'Video tidak ditemukan';
        } else if (error.message?.includes("timeout")) {
            errorMessage = 'Timeout saat download video';
        } else {
            errorMessage = error.message;
        }

        res.status(500).json({
            status: false,
            code: 500,
            author: AUTHOR,
            message: errorMessage
        });
    }
});

app.get('/api/yts', validateApiKey, async (req, res) => {
    try {
        const { query } = req.query;
        
        if (!query) {
            return res.status(400).json({
                status: false,
                code: 400,
                author: AUTHOR,
                message: 'Parameter "query" diperlukan!'
            });
        }

        console.log(`[YouTube Search] Request from ${req.user.username}: ${query}`);

        const results = await yts(query);
        
        if (!results.videos || results.videos.length === 0) {
            return res.status(404).json({
                status: false,
                code: 404,
                author: AUTHOR,
                message: `Tidak ditemukan video untuk: ${query}`
            });
        }

        const videos = results.videos.slice(0, 10).map(video => ({
            title: video.title,
            url: video.url,
            thumbnail: video.image,
            channel: video.author.name,
            duration: video.timestamp,
            views: video.views,
            uploaded: video.ago
        }));

        res.json({
            status: true,
            code: 200,
            author: AUTHOR,
            data: {
                query: query,
                total_results: results.videos.length,
                videos: videos
            }
        });

    } catch (error) {
        console.error('[YouTube Search Error]:', error);
        res.status(500).json({
            status: false,
            code: 500,
            author: AUTHOR,
            message: 'Internal server error',
            error: error.message
        });
    }
});

app.get('/api/spotify-search', validateApiKey, async (req, res) => {
    try {
        const { query, type = 'track', limit = 10 } = req.query;
        
        if (!query) {
            return res.status(400).json({
                status: false,
                code: 400,
                author: AUTHOR,
                message: 'Parameter "query" diperlukan!'
            });
        }

        console.log(`[Spotify Search] Request from ${req.user.username}: ${query}`);

        const token = await getSpotifyToken();

        const response = await axios.get('https://api.spotify.com/v1/search', {
            headers: {
                'Authorization': `Bearer ${token}`
            },
            params: {
                q: query,
                type: type,
                limit: parseInt(limit)
            }
        });

        const results = response.data;

        if (type === 'track' && results.tracks) {
            const tracks = results.tracks.items.map(track => ({
                id: track.id,
                title: track.name,
                artists: track.artists.map(artist => artist.name).join(', '),
                album: track.album.name,
                image_url: track.album.images[0]?.url || null,
                duration: new Date(track.duration_ms).toISOString().slice(14, 19),
                url: track.external_urls.spotify
            }));

            return res.json({
                status: true,
                code: 200,
                author: AUTHOR,
                data: {
                    query: query,
                    total: results.tracks.total,
                    tracks: tracks
                }
            });
        } else if (type === 'album' && results.albums) {
            const albums = results.albums.items.map(album => ({
                id: album.id,
                name: album.name,
                artists: album.artists.map(artist => artist.name).join(', '),
                release_date: album.release_date,
                total_tracks: album.total_tracks,
                image: album.images[0]?.url || null,
                url: album.external_urls.spotify
            }));

            return res.json({
                status: true,
                code: 200,
                author: AUTHOR,
                data: {
                    query: query,
                    total: results.albums.total,
                    albums: albums
                }
            });
        } else if (type === 'artist' && results.artists) {
            const artists = results.artists.items.map(artist => ({
                id: artist.id,
                name: artist.name,
                followers: artist.followers.total,
                genres: artist.genres,
                popularity: artist.popularity,
                image: artist.images[0]?.url || null,
                url: artist.external_urls.spotify
            }));

            return res.json({
                status: true,
                code: 200,
                author: AUTHOR,
                data: {
                    query: query,
                    total: results.artists.total,
                    artists: artists
                }
            });
        }

        return res.json({
            status: true,
            code: 200,
            author: AUTHOR,
            data: {
                query: query,
                total: 0,
                results: []
            }
        });

    } catch (error) {
        console.error('[Spotify Search Error]:', error);
        res.status(500).json({
            status: false,
            code: 500,
            author: AUTHOR,
            message: 'Internal server error',
            error: error.message
        });
    }
});

app.get('/api/tiktok-search', validateApiKey, async (req, res) => {
    try {
        const { query, count = 5 } = req.query;
        
        if (!query) {
            return res.status(400).json({
                status: false,
                code: 400,
                author: AUTHOR,
                message: 'Parameter "query" diperlukan!'
            });
        }

        console.log(`[TikTok Search] Request from ${req.user.username}: ${query}`);

        const searchUrl = `https://www.tikwm.com/api/feed/search?keywords=${encodeURIComponent(query)}&count=${Math.min(parseInt(count), 10)}`;
        const searchRes = await axios.get(searchUrl, { timeout: 20000 });
        const searchData = searchRes.data || {};
        
        let videos = null;
        if (Array.isArray(searchData.data)) videos = searchData.data;
        else if (Array.isArray(searchData.data?.videos)) videos = searchData.data.videos;
        else if (Array.isArray(searchData.data?.list)) videos = searchData.data.list;
        else if (Array.isArray(searchData.data?.aweme_list)) videos = searchData.data.aweme_list;
        else videos = searchData.data ? (Array.isArray(searchData.data) ? searchData.data : []) : [];
        
        if (!videos || videos.length === 0) {
            return res.status(404).json({
                status: false,
                code: 404,
                author: AUTHOR,
                message: `Tidak ditemukan video TikTok untuk: ${query}`
            });
        }

        const formattedVideos = videos.slice(0, count).map(v => {
            const authorId = v.author?.unique_id || v.author?.nickname || v.user?.unique_id || v.owner?.unique_id || "unknown";
            const videoId = v.video_id || v.id || v.aweme_id || v.short_id || (v.video && v.video.id);
            const tiktokUrl = videoId ? `https://www.tiktok.com/@${authorId}/video/${videoId}` : (v.share_url || v.video?.share_url || v.url);
            
            return {
                id: videoId,
                title: v.title || "Video TikTok",
                author: {
                    id: authorId,
                    nickname: v.author?.nickname || v.user?.nickname || v.owner?.nickname || authorId,
                    avatar: v.author?.avatar || v.user?.avatar || v.owner?.avatar || null
                },
                stats: {
                    likes: v.digg_count || v.play_count || 0,
                    comments: v.comment_count || 0,
                    shares: v.share_count || 0,
                    plays: v.play_count || 0
                },
                duration: v.duration || 0,
                cover: v.cover || v.video?.cover || null,
                url: tiktokUrl,
                thumbnail: v.origin_cover || v.video?.origin_cover || null
            };
        });

        res.json({
            status: true,
            code: 200,
            author: AUTHOR,
            data: {
                query: query,
                total: videos.length,
                videos: formattedVideos
            }
        });

    } catch (error) {
        console.error('[TikTok Search Error]:', error);
        
        let errorMessage = 'Internal server error';
        if (error.message?.includes("timeout")) {
            errorMessage = 'Timeout saat mencari video';
        } else if (error.message?.includes("ENOTFOUND")) {
            errorMessage = 'Gagal terhubung ke server TikTok';
        } else {
            errorMessage = error.message;
        }

        res.status(500).json({
            status: false,
            code: 500,
            author: AUTHOR,
            message: errorMessage
        });
    }
});

const getStrongObfuscationConfig = () => {
    return {
        target: "node",
        calculator: true,
        compact: true,
        hexadecimalNumbers: true,
        controlFlowFlattening: 0.75,
        deadCode: 0.2,
        dispatcher: true,
        duplicateLiteralsRemoval: 0.75,
        flatten: true,
        globalConcealing: true,
        identifierGenerator: "zeroWidth",
        minify: true,
        movedDeclarations: true,
        objectExtraction: true,
        opaquePredicates: 0.75,
        renameVariables: true,
        renameGlobals: true,
        stringConcealing: true,
        stringCompression: true,
        stringEncoding: true,
        stringSplitting: 0.75,
        rgf: false,
    };
};

app.post('/api/js-obfuscate', validateApiKey, async (req, res) => {
    try {
        if (!req.files || !req.files.file) {
            return res.status(400).json({
                status: false,
                code: 400,
                author: AUTHOR,
                message: 'File JavaScript diperlukan!'
            });
        }

        const uploadedFile = req.files.file;
        const fileName = uploadedFile.name;

        if (!fileName.toLowerCase().endsWith('.js')) {
            return res.status(400).json({
                status: false,
                code: 400,
                author: AUTHOR,
                message: 'File harus berekstensi .js!'
            });
        }

        console.log(`[JS Obfuscator] Request from ${req.user.username}: ${fileName}`);

        const fileContent = uploadedFile.data.toString('utf8');

        try {
            new Function(fileContent);
        } catch (syntaxErr) {
            return res.status(400).json({
                status: false,
                code: 400,
                author: AUTHOR,
                message: 'Syntax error dalam file JavaScript',
                error: syntaxErr.message
            });
        }

        let obfResult;
        try {
            obfResult = await JsConfuser.obfuscate(fileContent, getStrongObfuscationConfig());
        } catch (obfErr) {
            console.error('Obfuscate error:', obfErr);
            return res.status(500).json({
                status: false,
                code: 500,
                author: AUTHOR,
                message: 'Gagal melakukan obfuscation',
                error: obfErr.message
            });
        }

        const obfuscatedCode = typeof obfResult === "string" ? obfResult : obfResult.code;

        try {
            new Function(obfuscatedCode);
        } catch (postErr) {
            return res.status(500).json({
                status: false,
                code: 500,
                author: AUTHOR,
                message: 'Hasil obfuscation tidak valid',
                error: postErr.message
            });
        }

        const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
        const outputFileName = `obfuscated-${Date.now()}-${safeName}`;

        const base64Content = Buffer.from(obfuscatedCode).toString('base64');

        res.json({
            status: true,
            code: 200,
            author: AUTHOR,
            data: {
                original_file: fileName,
                output_file: outputFileName,
                size: {
                    original: fileContent.length,
                    obfuscated: obfuscatedCode.length
                },
                content_base64: base64Content,
                content_preview: obfuscatedCode.substring(0, 500) + (obfuscatedCode.length > 500 ? '...' : '')
            }
        });

    } catch (error) {
        console.error('[JS Obfuscator Error]:', error);
        res.status(500).json({
            status: false,
            code: 500,
            author: AUTHOR,
            message: 'Internal server error',
            error: error.message
        });
    }
});

app.post('/api/js-obfuscate-text', validateApiKey, async (req, res) => {
    try {
        const { code } = req.body;

        if (!code) {
            return res.status(400).json({
                status: false,
                code: 400,
                author: AUTHOR,
                message: 'Parameter "code" diperlukan!'
            });
        }

        console.log(`[JS Obfuscator Text] Request from ${req.user.username}`);

        try {
            new Function(code);
        } catch (syntaxErr) {
            return res.status(400).json({
                status: false,
                code: 400,
                author: AUTHOR,
                message: 'Syntax error dalam kode JavaScript',
                error: syntaxErr.message
            });
        }

        let obfResult;
        try {
            obfResult = await JsConfuser.obfuscate(code, getStrongObfuscationConfig());
        } catch (obfErr) {
            console.error('Obfuscate error:', obfErr);
            return res.status(500).json({
                status: false,
                code: 500,
                author: AUTHOR,
                message: 'Gagal melakukan obfuscation',
                error: obfErr.message
            });
        }

        const obfuscatedCode = typeof obfResult === "string" ? obfResult : obfResult.code;

        res.json({
            status: true,
            code: 200,
            author: AUTHOR,
            data: {
                original_size: code.length,
                obfuscated_size: obfuscatedCode.length,
                obfuscated_code: obfuscatedCode
            }
        });

    } catch (error) {
        console.error('[JS Obfuscator Text Error]:', error);
        res.status(500).json({
            status: false,
            code: 500,
            author: AUTHOR,
            message: 'Internal server error',
            error: error.message
        });
    }
});

async function uploadToCatbox(buffer) {
    try {
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('fileToUpload', buffer, { filename: 'file.bin' });
        const res = await axios.post('https://catbox.moe/user/api.php', form, {
            headers: form.getHeaders(),
            timeout: 30000
        });
        const url = res.data.trim();
        if (url.startsWith('http')) {
            return url;
        }
        return null;
    } catch (e) {
        console.error("Catbox Error:", e.message);
        return null;
    }
}

async function uploadToSupa(buffer) {
    try {
        const form = new FormData();
        form.append('file', buffer, 'upload.jpg');
        const res = await axios.post('https://i.supa.codes/api/upload', form, {
            headers: form.getHeaders(),
            timeout: 30000
        });
        return res.data?.link || null;
    } catch (error) {
        console.error('Supa Upload Error:', error?.response?.data || error.message);
        return null;
    }
}

async function uploadToTmpFiles(buffer, ext, mime) {
    try {
        const form = new FormData();
        form.append('file', buffer, {
            filename: `${Date.now()}.${ext}`,
            contentType: mime
        });
        const res = await axios.post('https://tmpfiles.org/api/v1/upload', form, {
            headers: form.getHeaders(),
            timeout: 30000
        });
        return res.data?.data?.url?.replace('s.org/', 's.org/dl/') || null;
    } catch (error) {
        console.error('TmpFiles Error:', error.message);
        return null;
    }
}

async function uploadToUguu(filePath) {
    try {
        const form = new FormData();
        form.append('files[]', fs.createReadStream(filePath));
        const res = await axios.post('https://uguu.se/upload.php', form, {
            headers: form.getHeaders(),
            timeout: 30000
        });
        return res.data.files?.[0]?.url || null;
    } catch (error) {
        console.error('Uguu Upload Error:', error.message);
        return null;
    }
}

async function uploadToFreeImageHost(buffer) {
    try {
        let isImageBuffer = false;
        
        const firstBytes = buffer.slice(0, 12);
        const hex = firstBytes.toString('hex').toLowerCase();
        
        if (
            hex.startsWith('ffd8ff') ||
            hex.startsWith('89504e47') || 
            hex.startsWith('47494638') ||
            hex.startsWith('52494646') ||
            hex.startsWith('424d') ||
            hex.startsWith('49492a00') ||
            hex.startsWith('4d4d002a')
        ) {
            isImageBuffer = true;
        }
        
        if (!isImageBuffer) {
            return null;
        }

        const form = new FormData();
        form.append('source', buffer, 'file.png');
        const res = await axios.post('https://freeimage.host/api/1/upload', form, {
            params: { key: '6d207e02198a847aa98d0a2a901485a5' },
            headers: form.getHeaders(),
            timeout: 30000
        });
        return res.data?.image?.url || null;
    } catch (error) {
        console.error('FreeImage.Host Error:', error?.response?.data || error.message);
        return null;
    }
}

function detectFileType(buffer) {
    const firstBytes = buffer.slice(0, 12);
    const hex = firstBytes.toString('hex').toLowerCase();
    
    if (hex.startsWith('ffd8ff')) {
        return { ext: 'jpg', mime: 'image/jpeg' };
    } else if (hex.startsWith('89504e47')) {
        return { ext: 'png', mime: 'image/png' };
    } else if (hex.startsWith('47494638')) {
        return { ext: 'gif', mime: 'image/gif' };
    } else if (hex.startsWith('52494646') && buffer.slice(8, 12).toString() === 'WEBP') {
        return { ext: 'webp', mime: 'image/webp' };
    } else if (hex.startsWith('424d')) {
        return { ext: 'bmp', mime: 'image/bmp' };
    } else if (hex.startsWith('49492a00') || hex.startsWith('4d4d002a')) {
        return { ext: 'tiff', mime: 'image/tiff' };
    } else if (hex.startsWith('1f8b08')) {
        return { ext: 'gz', mime: 'application/gzip' };
    } else if (hex.startsWith('504b0304') || hex.startsWith('504b0506') || hex.startsWith('504b0708')) {
        return { ext: 'zip', mime: 'application/zip' };
    } else if (hex.startsWith('25504446')) {
        return { ext: 'pdf', mime: 'application/pdf' };
    } else if (hex.startsWith('00000018')) {
        return { ext: 'mp4', mime: 'video/mp4' };
    } else if (hex.startsWith('00000020')) {
        return { ext: 'mp4', mime: 'video/mp4' };
    } else if (hex.startsWith('3026b2758e66cf11a6d900aa0062ce6c')) {
        return { ext: 'wmv', mime: 'video/x-ms-wmv' };
    }
    
    return { ext: 'bin', mime: 'application/octet-stream' };
}

app.post('/api/upload', validateApiKey, async (req, res) => {
    try {
        if (!req.files || !req.files.file) {
            return res.status(400).json({
                status: false,
                code: 400,
                author: AUTHOR,
                message: 'File diperlukan!'
            });
        }

        const uploadedFile = req.files.file;
        const buffer = uploadedFile.data;

        console.log(`[Media Upload] Request from ${req.user.username}: ${uploadedFile.name} (${buffer.length} bytes)`);

        if (!buffer || buffer.length === 0) {
            return res.status(400).json({
                status: false,
                code: 400,
                author: AUTHOR,
                message: 'File kosong!'
            });
        }

        const fileType = detectFileType(buffer);
        const ext = fileType.ext;
        const mime = fileType.mime;
        const isImage = mime.startsWith('image/');

        const fileSizeInBytes = buffer.length;
        const fileSizeInMB = (fileSizeInBytes / (1024 * 1024)).toFixed(2);
        const size = `${fileSizeInMB} MB`;

        const tmpFile = path.join(os.tmpdir(), `${uuidv4()}.${ext}`);
        fs.writeFileSync(tmpFile, buffer);

        const uploadPromises = [
            uploadToCatbox(buffer),
            uploadToSupa(buffer),
            uploadToTmpFiles(buffer, ext, mime),
            uploadToUguu(tmpFile),
        ];

        if (isImage) {
            uploadPromises.push(uploadToFreeImageHost(buffer));
        }

        const results = await Promise.all(uploadPromises);

        try {
            fs.unlinkSync(tmpFile);
        } catch (unlinkErr) {
            console.warn("Gagal hapus file sementara:", unlinkErr.message);
        }

        const catboxLink = results[0];
        const supaLink = results[1];
        const tmpLink = results[2];
        const uguuLink = results[3];
        const freeImageHostLink = isImage ? results[4] : null;

        const uploadedUrls = {};
        
        if (catboxLink) uploadedUrls.catbox = catboxLink;
        if (supaLink) uploadedUrls.supa = supaLink;
        if (tmpLink) uploadedUrls.tmpfiles = tmpLink;
        if (uguuLink) uploadedUrls.uguu = uguuLink;
        if (freeImageHostLink) uploadedUrls.freeimage = freeImageHostLink;

        const hasLink = Object.keys(uploadedUrls).length > 0;

        if (!hasLink) {
            return res.status(500).json({
                status: false,
                code: 500,
                author: AUTHOR,
                message: 'Semua layanan upload gagal'
            });
        }

        res.json({
            status: true,
            code: 200,
            author: AUTHOR,
            data: {
                filename: uploadedFile.name,
                size: size,
                size_bytes: fileSizeInBytes,
                mime_type: mime,
                is_image: isImage,
                url: uploadedUrls
            }
        });

    } catch (error) {
        console.error('[Media Upload Error]:', error);
        res.status(500).json({
            status: false,
            code: 500,
            author: AUTHOR,
            message: 'Internal server error',
            error: error.message
        });
    }
});

app.post('/api/upload-url', validateApiKey, async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({
                status: false,
                code: 400,
                author: AUTHOR,
                message: 'Parameter "url" diperlukan!'
            });
        }

        console.log(`[Media Upload URL] Request from ${req.user.username}: ${url}`);

        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 30000
        });

        const buffer = Buffer.from(response.data);
        const contentType = response.headers['content-type'] || 'application/octet-stream';

        const fileType = detectFileType(buffer);
        const ext = fileType.ext;
        const mime = fileType.mime;
        const isImage = mime.startsWith('image/');

        const fileSizeInBytes = buffer.length;
        const fileSizeInMB = (fileSizeInBytes / (1024 * 1024)).toFixed(2);
        const size = `${fileSizeInMB} MB`;

        const tmpFile = path.join(os.tmpdir(), `${uuidv4()}.${ext}`);
        fs.writeFileSync(tmpFile, buffer);

        const uploadPromises = [
            uploadToCatbox(buffer),
            uploadToSupa(buffer),
            uploadToTmpFiles(buffer, ext, mime),
            uploadToUguu(tmpFile),
        ];

        if (isImage) {
            uploadPromises.push(uploadToFreeImageHost(buffer));
        }

        const results = await Promise.all(uploadPromises);

        try {
            fs.unlinkSync(tmpFile);
        } catch (unlinkErr) {
            console.warn("Gagal hapus file sementara:", unlinkErr.message);
        }

        const catboxLink = results[0];
        const supaLink = results[1];
        const tmpLink = results[2];
        const uguuLink = results[3];
        const freeImageHostLink = isImage ? results[4] : null;

        const uploadedUrls = {};
        
        if (catboxLink) uploadedUrls.catbox = catboxLink;
        if (supaLink) uploadedUrls.supa = supaLink;
        if (tmpLink) uploadedUrls.tmpfiles = tmpLink;
        if (uguuLink) uploadedUrls.uguu = uguuLink;
        if (freeImageHostLink) uploadedUrls.freeimage = freeImageHostLink;

        const hasLink = Object.keys(uploadedUrls).length > 0;

        if (!hasLink) {
            return res.status(500).json({
                status: false,
                code: 500,
                author: AUTHOR,
                message: 'Semua layanan upload gagal'
            });
        }

        res.json({
            status: true,
            code: 200,
            author: AUTHOR,
            data: {
                source_url: url,
                size: size,
                size_bytes: fileSizeInBytes,
                mime_type: mime,
                is_image: isImage,
                url: uploadedUrls
            }
        });

    } catch (error) {
        console.error('[Media Upload URL Error]:', error);
        res.status(500).json({
            status: false,
            code: 500,
            author: AUTHOR,
            message: 'Internal server error',
            error: error.message
        });
    }
});

const API_ID = parseInt(process.env.TELEGRAM_API_ID) || 1234567;
const API_HASH = process.env.TELEGRAM_API_HASH || 'your_api_hash';
const PHONE_NUMBER = process.env.TELEGRAM_PHONE || '+6281234567890';
const SESSION_FOLDER = process.env.TELEGRAM_SESSION_FOLDER || './sessions';

fs.ensureDirSync(SESSION_FOLDER);
const TELEGRAM_SESSION_FILE = path.join(SESSION_FOLDER, 'telegram_session.txt');

async function getTelegramSession() {
    try {
        if (await fs.pathExists(TELEGRAM_SESSION_FILE)) {
            const sessionData = await fs.readFile(TELEGRAM_SESSION_FILE, 'utf-8');
            return new StringSession(sessionData);
        }
    } catch (error) {
        console.log('No existing Telegram session found');
    }
    return new StringSession('');
}

async function saveTelegramSession(sessionString) {
    await fs.writeFile(TELEGRAM_SESSION_FILE, sessionString, 'utf-8');
}

let telegramClient = null;

async function initTelegramClient() {
    const session = await getTelegramSession();
    const client = new TelegramClient(session, API_ID, API_HASH, {
        connectionRetries: 5,
        useWSS: true,
    });

    await client.start({
        phoneNumber: PHONE_NUMBER,
        password: async () => await input.text('Password (2FA): '),
        phoneCode: async () => await input.text('Verification Code: '),
        onError: (err) => console.log('Login error:', err),
    });

    console.log('✅ Telegram Client Connected!');
    
    const sessionString = client.session.save();
    await saveTelegramSession(sessionString);
    
    return client;
}

(async () => {
    try {
        telegramClient = await initTelegramClient();
    } catch (error) {
        console.error('Failed to initialize Telegram client:', error.message);
    }
})();

app.get('/api/telegram', validateApiKey, async (req, res) => {
    try {
        const { username } = req.query;
        
        if (!username) {
            return res.status(400).json({ 
                status: false,
                code: 400,
                author: AUTHOR,
                message: 'Parameter "username" diperlukan' 
            });
        }

        if (!telegramClient || !telegramClient.connected) {
            return res.status(503).json({
                status: false,
                code: 503,
                author: AUTHOR,
                message: 'Telegram client tidak terhubung'
            });
        }

        const cleanUsername = username.replace('@', '').trim();
        console.log(`[Telegram Stalker] Looking up user: @${cleanUsername} (API Key: ${req.user.apikey})`);

        let user;
        try {
            user = await telegramClient.getEntity(cleanUsername);
        } catch (error) {
            return res.status(404).json({ 
                status: false,
                code: 404,
                author: AUTHOR, 
                message: 'User tidak ditemukan' 
            });
        }

        let fullUser = null;
        try {
            fullUser = await telegramClient.invoke(
                new Api.users.GetFullUser({
                    id: user.id
                })
            );
        } catch (error) {
            console.log('[Telegram Stalker] Error getting full user:', error.message);
        }

        const userData = {
            id: user.id.toString(),
            username: user.username || cleanUsername,
            first_name: user.firstName || '',
            last_name: user.lastName || '',
            full_name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'No Name',
            phone: user.phone || 'Hidden',
            bio: fullUser?.fullUser?.about || '',
            last_seen: 'Hidden',
            type: user.bot ? 'bot' : 'user',
            scam: user.scam || false,
            fake: user.fake || false,
            is_bot: user.bot || false,
            verified: user.verified || false,
            restricted: user.restricted || false
        };

        if (user.status) {
            if (user.status.className === 'UserStatusOnline') {
                userData.last_seen = 'Online';
                userData.status = 'online';
            } else if (user.status.className === 'UserStatusOffline') {
                const date = new Date(user.status.wasOnline * 1000);
                userData.last_seen = date.toISOString();
                userData.last_seen_formatted = date.toLocaleString('id-ID');
                userData.status = 'offline';
            } else if (user.status.className === 'UserStatusRecently') {
                userData.last_seen = 'Recently';
                userData.status = 'recently';
            } else if (user.status.className === 'UserStatusLastWeek') {
                userData.last_seen = 'Last week';
                userData.status = 'last_week';
            } else if (user.status.className === 'UserStatusLastMonth') {
                userData.last_seen = 'Last month';
                userData.status = 'last_month';
            }
        }

        res.json({
            status: true,
            code: 200,
            author: AUTHOR,
            data: userData
        });

    } catch (error) {
        console.error('[Telegram Stalker API Error]:', error);
        res.status(500).json({ 
            status: false,
            code: 500,
            author: AUTHOR, 
            message: 'Internal server error',
            error: error.message 
        });
    }
});

app.get('/api/telegram/media', validateApiKey, async (req, res) => {
    try {
        const { username } = req.query;
        
        if (!username) {
            return res.status(400).json({ 
                status: false,
                code: 400,
                author: AUTHOR, 
                message: 'Username diperlukan' 
            });
        }

        if (!telegramClient || !telegramClient.connected) {
            return res.status(503).json({
                status: false,
                code: 503,
                author: AUTHOR,
                message: 'Telegram client tidak terhubung'
            });
        }

        const cleanUsername = username.replace('@', '').trim();
        console.log(`[Telegram Media] Fetching media for @${cleanUsername} (API Key: ${req.user.apikey})`);

        let user;
        try {
            user = await telegramClient.getEntity(cleanUsername);
        } catch (error) {
            return res.status(404).json({ 
                status: false,
                code: 404,
                author: AUTHOR, 
                message: 'User tidak ditemukan' 
            });
        }

        const media = { photos: [] };

        try {
            if (user && user.id) {
                const result = await telegramClient.invoke(
                    new Api.photos.GetUserPhotos({
                        userId: user.id,
                        offset: 0,
                        limit: 10,
                        maxId: 0
                    })
                );

                if (result && result.photos && result.photos.length > 0) {
                    for (const photo of result.photos) {
                        try {
                            const buffer = await telegramClient.downloadMedia(photo, {});
                            if (buffer && buffer.length > 0) {
                                const base64 = buffer.toString('base64');
                                let mimeType = 'image/jpeg';
                                if (base64.startsWith('/9j/')) mimeType = 'image/jpeg';
                                else if (base64.startsWith('iVBOR')) mimeType = 'image/png';
                                
                                media.photos.push({
                                    url: `data:${mimeType};base64,${base64}`,
                                    type: mimeType,
                                    size: buffer.length
                                });
                            }
                        } catch (downloadError) {
                            console.log('[Telegram Media] Error downloading photo:', downloadError.message);
                        }
                    }
                }
            }
        } catch (error) {
            console.log('[Telegram Media] Error getting photos:', error.message);
        }

        if (media.photos.length === 0 && user.photo) {
            try {
                const photo = await telegramClient.downloadProfilePhoto(user, { isBig: true });
                if (photo) {
                    const base64 = photo.toString('base64');
                    media.photos.push({
                        url: `data:image/jpeg;base64,${base64}`,
                        type: 'image/jpeg',
                        size: photo.length
                    });
                }
            } catch (photoError) {
                console.log('[Telegram Media] Error downloading profile photo:', photoError.message);
            }
        }

        res.json({
            status: true,
            code: 200,
            author: AUTHOR,
            data: {
                username: cleanUsername,
                total_photos: media.photos.length,
                photos: media.photos
            }
        });

    } catch (error) {
        console.error('[Telegram Media API Error]:', error);
        res.status(500).json({ 
            status: false,
            code: 500,
            author: AUTHOR, 
            message: 'Internal server error',
            error: error.message
        });
    }
});

app.get('/api/telegram/info', validateApiKey, async (req, res) => {
    try {
        const { username } = req.query;
        
        if (!username) {
            return res.status(400).json({
                status: false,
                code: 400,
                author: AUTHOR,
                message: 'Parameter "username" diperlukan'
            });
        }

        if (!telegramClient || !telegramClient.connected) {
            return res.status(503).json({
                status: false,
                code: 503,
                author: AUTHOR,
                message: 'Telegram client tidak terhubung'
            });
        }

        const cleanUsername = username.replace('@', '').trim();
        console.log(`[Telegram Info] Fetching info for @${cleanUsername} (API Key: ${req.user.apikey})`);

        let user;
        try {
            user = await telegramClient.getEntity(cleanUsername);
        } catch (error) {
            return res.status(404).json({
                status: false,
                code: 404,
                author: AUTHOR,
                message: 'User tidak ditemukan'
            });
        }

        const fullUser = await telegramClient.invoke(
            new Api.users.GetFullUser({
                id: user.id
            })
        );

        const userData = {
            basic_info: {
                id: user.id.toString(),
                username: user.username,
                first_name: user.firstName || '',
                last_name: user.lastName || '',
                full_name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'No Name',
                phone: user.phone || 'Hidden',
                is_bot: user.bot || false,
                verified: user.verified || false,
                restricted: user.restricted || false,
                scam: user.scam || false,
                fake: user.fake || false
            },
            profile: {
                bio: fullUser?.fullUser?.about || 'Tidak ada bio',
                profile_photos_count: fullUser?.fullUser?.profilePhoto ? 1 : 0,
                dc_id: fullUser?.fullUser?.profilePhoto?.dcId || null
            },
            privacy: {
                last_seen: fullUser?.fullUser?.status?.className || 'Unknown',
                has_photo: !!user.photo,
                premium: user.premium || false
            }
        };

        res.json({
            status: true,
            code: 200,
            author: AUTHOR,
            data: userData
        });

    } catch (error) {
        console.error('[Telegram Info API Error]:', error);
        res.status(500).json({
            status: false,
            code: 500,
            author: AUTHOR,
            message: 'Internal server error',
            error: error.message
        });
    }
});

app.get('/api/telegram/status', (req, res) => {
    const isConnected = telegramClient && telegramClient.connected;
    
    res.json({
        status: true,
        code: 200,
        author: AUTHOR,
        data: {
            connected: isConnected,
            phone_number: PHONE_NUMBER ? PHONE_NUMBER.replace(/\d(?=\d{4})/g, '*') : null,
            session_exists: fs.existsSync(TELEGRAM_SESSION_FILE)
        }
    });
});

app.post('/api/telegram/reconnect', validateApiKey, async (req, res) => {
    try {
        console.log(`[Telegram] Reconnecting client... (API Key: ${req.user.apikey})`);
        
        if (telegramClient && telegramClient.connected) {
            await telegramClient.disconnect();
        }
        
        telegramClient = await initTelegramClient();
        
        res.json({
            status: true,
            code: 200,
            author: AUTHOR,
            message: 'Telegram client reconnected successfully'
        });
    } catch (error) {
        console.error('[Telegram Reconnect Error]:', error);
        res.status(500).json({
            status: false,
            code: 500,
            author: AUTHOR,
            message: 'Failed to reconnect Telegram client',
            error: error.message
        });
    }
});

app.get('/api/user/profile', verifyToken, async (req, res) => {
    try {
        const db = await readDatabase();
        const user = db.users.find(u => u.id === req.user.id);
        
        if (!user) {
            return res.status(404).json({
                status: false,
                code: 404,
                message: 'User tidak ditemukan'
            });
        }

        let remainingDays = 0;
        if (user.expired_at) {
            const expired = new Date(user.expired_at);
            const now = new Date();
            const diffTime = expired - now;
            remainingDays = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
        }

        res.json({
            status: true,
            code: 200,
            author: AUTHOR,
            data: {
                username: user.username,
                email: user.email,
                apikey: user.apikey,
                hit: user.hit,
                limit: user.limit,
                remaining: user.limit - user.hit,
                remaining_days: remainingDays,
                role: user.role || 'REGULAR',
                expired_at: user.expired_at || null,
                created_at: user.created_at,
                last_login: user.last_login,
                updated_at: user.updated_at || user.created_at,
                endpoint_hits: user.endpoint_hits || {}
            }
        });

    } catch (error) {
        console.error('[Profile API Error]:', error);
        res.status(500).json({
            status: false,
            code: 500,
            message: 'Internal server error',
            error: error.message
        });
    }
});

app.put('/api/user/profile', verifyToken, async (req, res) => {
    try {
        const { username, email } = req.body;
        const db = await readDatabase();
        const userIndex = db.users.findIndex(u => u.id === req.user.id);
        
        if (userIndex === -1) {
            return res.status(404).json({
                status: false,
                code: 404,
                message: 'User tidak ditemukan'
            });
        }

        if (username) db.users[userIndex].username = username;
        if (email) db.users[userIndex].email = email;
        
        db.users[userIndex].updated_at = new Date().toISOString();
        await writeDatabase(db);

        res.json({
            status: true,
            code: 200,
            author: AUTHOR,
            message: 'Profil berhasil diperbarui',
            data: {
                username: db.users[userIndex].username,
                email: db.users[userIndex].email,
                updated_at: db.users[userIndex].updated_at
            }
        });

    } catch (error) {
        console.error('[Profile Update Error]:', error);
        res.status(500).json({
            status: false,
            code: 500,
            message: 'Internal server error',
            error: error.message
        });
    }
});

app.get('/api/user/activity', verifyToken, async (req, res) => {
    try {
        const db = await readDatabase();
        const user = db.users.find(u => u.id === req.user.id);
        
        if (!user) {
            return res.status(404).json({
                status: false,
                code: 404,
                message: 'User tidak ditemukan'
            });
        }

        const activities = [
            {
                label: 'Login terakhir',
                value: user.last_login ? new Date(user.last_login).toLocaleString('id-ID', { 
                    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' 
                }) : 'Belum pernah login',
                icon: 'fa-sign-in-alt'
            },
            {
                label: 'Pertama kali daftar',
                value: new Date(user.created_at).toLocaleString('id-ID', { 
                    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' 
                }),
                icon: 'fa-user-plus'
            },
            {
                label: 'API Key dibuat',
                value: new Date(user.created_at).toISOString(),
                icon: 'fa-key'
            },
            {
                label: 'Profil diperbarui',
                value: user.updated_at ? new Date(user.updated_at).toLocaleString('id-ID') : new Date(user.created_at).toLocaleString('id-ID'),
                icon: 'fa-user-edit'
            },
            {
                label: 'Endpoint terhubung',
                value: `${user.hit} request dari ${user.limit} limit`,
                icon: 'fa-plug'
            }
        ];

        res.json({
            status: true,
            code: 200,
            author: AUTHOR,
            data: activities
        });

    } catch (error) {
        console.error('[Activity API Error]:', error);
        res.status(500).json({
            status: false,
            code: 500,
            message: 'Internal server error',
            error: error.message
        });
    }
});

app.get('/profile', verifyToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'profile.html'));
});

app.get('/api/stats', async (req, res) => {
    const db = await readDatabase();
    res.json({
        status: true,
        code: 200,
        author: AUTHOR,
        data: {
            total_users: db.users.length,
            total_requests: db.total_requests,
            active_users: db.users.filter(u => u.status === 'active').length
        }
    });
});

app.get('/api/dashboard/stats', (req, res) => {
    try {
        const stats = {
            total_endpoints: 243,
            total_categories: 14,
            server: {
                location: 'Singapore, SG',
                provider: '16509 Amazon.com, Inc.'
            },
            performance: {
                upload_speed: '51.0 Mbps',
                ping: '73 ms',
                response_time: '2.7 sec'
            },
            provider: {
                name: 'Yudzxml',
                verified: true
            }
        };

        res.json({
            status: true,
            code: 200,
            author: AUTHOR,
            data: stats
        });

    } catch (error) {
        console.error('[Dashboard Stats Error]:', error);
        res.status(500).json({
            status: false,
            code: 500,
            author: AUTHOR,
            message: 'Internal server error'
        });
    }
});

app.get('/api/dashboard/features', (req, res) => {
    try {
        const features = [
            {
                icon: 'bolt',
                iconColor: '#f3d359',
                title: 'Lightning Fast',
                description: 'Optimized REST APIs with low latency and high throughput'
            },
            {
                icon: 'shield-alt',
                iconColor: '#75d5b5',
                title: 'Enterprise Security',
                description: 'Bank-level security with encryption and authentication'
            },
            {
                icon: 'code',
                iconColor: '#bd93f9',
                title: 'Developer First',
                description: 'RESTful APIs with comprehensive documentation'
            }
        ];

        res.json({
            status: true,
            code: 200,
            author: AUTHOR,
            data: features
        });

    } catch (error) {
        console.error('[Dashboard Features Error]:', error);
        res.status(500).json({
            status: false,
            code: 500,
            author: AUTHOR,
            message: 'Internal server error'
        });
    }
});

app.get('/api/system/uptime', (req, res) => {
    try {
        const uptimeSeconds = process.uptime();
        const days = Math.floor(uptimeSeconds / 86400);
        const hours = Math.floor((uptimeSeconds % 86400) / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);
        const seconds = Math.floor(uptimeSeconds % 60);

        res.json({
            status: true,
            code: 200,
            author: AUTHOR,
            data: {
                uptime: `${days}d ${hours}h ${minutes}m ${seconds}s`,
                uptime_seconds: uptimeSeconds,
                started_at: new Date(Date.now() - uptimeSeconds * 1000).toISOString()
            }
        });

    } catch (error) {
        console.error('[Uptime Error]:', error);
        res.status(500).json({
            status: false,
            code: 500,
            author: AUTHOR,
            message: 'Internal server error'
        });
    }
});

app.get('/api/system/info', (req, res) => {
    try {
        const memoryUsage = process.memoryUsage();
        
        res.json({
            status: true,
            code: 200,
            author: AUTHOR,
            data: {
                node_version: process.version,
                platform: process.platform,
                arch: process.arch,
                memory: {
                    rss: Math.round(memoryUsage.rss / 1024 / 1024) + ' MB',
                    heap_total: Math.round(memoryUsage.heapTotal / 1024 / 1024) + ' MB',
                    heap_used: Math.round(memoryUsage.heapUsed / 1024 / 1024) + ' MB'
                },
                cwd: process.cwd(),
                pid: process.pid
            }
        });

    } catch (error) {
        console.error('[System Info Error]:', error);
        res.status(500).json({
            status: false,
            code: 500,
            author: AUTHOR,
            message: 'Internal server error'
        });
    }
});

app.use((req, res) => {
    res.status(404).json({
        status: false,
        code: 404,
        author: AUTHOR,
        message: 'Endpoint tidak ditemukan'
    });
});

app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).json({
        status: false,
        code: 500,
        author: AUTHOR,
        message: 'Internal server error',
        error: err.message
    });
});

// Vercel Serverless entry point. No PORT and no app.listen() are needed.
module.exports = app;
