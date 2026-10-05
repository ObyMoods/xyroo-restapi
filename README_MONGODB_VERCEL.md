# Yakuza API V2 - MongoDB + Vercel

Versi ini menyimpan data aplikasi di MongoDB melalui `process.env.MONGODB_URI`.

## Vercel Environment Variables

Set di Project Settings -> Environment Variables:

```env
MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@CLUSTER.mongodb.net/yakuza_api?retryWrites=true&w=majority
MONGODB_DB=yakuza_api
JWT_SECRET=buat-secret-random-yang-panjang
```

Jangan commit password MongoDB ke GitHub.

## Deploy

1. Upload project ke GitHub.
2. Import repository di Vercel.
3. Tambahkan environment variables di atas.
4. Deploy.

## Database

Aplikasi memakai database MongoDB yang dipilih oleh `MONGODB_DB` dan collection `appdata`.
Dokumen utama menyimpan `users`, `total_users`, dan `total_requests`.

Connection MongoDB dicache pada instance serverless untuk mengurangi koneksi berulang.

## Catatan Vercel

Filesystem lokal bukan storage permanen. Karena itu `database.json` sudah dihapus dan seluruh data akun/API key/statistik disimpan di MongoDB.

Fitur yang membutuhkan file/session lokal tetap mengikuti batasan filesystem serverless Vercel; untuk session permanen gunakan storage eksternal.

## Vercel / Port

Project ini tidak menggunakan `PORT` atau `app.listen()`. Vercel menangani port dan HTTP server secara otomatis. Setelah deploy, akses melalui URL domain Vercel, misalnya `https://nama-project.vercel.app`.
