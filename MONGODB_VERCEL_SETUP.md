# MongoDB + Vercel

Tambahkan Environment Variables di Vercel:

```env
MONGODB_URI=mongodb+srv://fanzmmq_db_user:YOUR_MONGODB_PASSWORD@db-restapi.ljy5pzb.mongodb.net/yakuza_api?retryWrites=true&w=majority
MONGODB_DB=yakuza_api
JWT_SECRET=change-this-to-a-long-random-secret
```

Ganti `YOUR_MONGODB_PASSWORD` dengan password Database User MongoDB Atlas.
Jangan commit password asli ke GitHub.
