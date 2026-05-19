// // /BackEnd/mongo-init/01-init.js
// db.getSiblingDB('admin').updateUser(
//   process.env.MONGO_INITDB_ROOT_USERNAME,
//   { pwd: process.env.MONGO_INITDB_ROOT_PASSWORD }
// );
// // หรือถ้า user ยังไม่มี
// db.getSiblingDB('admin').createUser({
//   user: process.env.MONGO_INITDB_ROOT_USERNAME,
//   pwd:  process.env.MONGO_INITDB_ROOT_PASSWORD,
//   roles: [{ role: 'root', db: 'admin' }]
// });