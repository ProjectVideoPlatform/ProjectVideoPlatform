import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { init as initApm } from '@elastic/apm-rum'

const apm = initApm({
  // 1. ตั้งชื่อ Service สำหรับ Frontend แยกกับ Backend ให้ชัดเจน
  serviceName: 'toteja-frontend',

  // 2. ชี้ URL ไปที่ APM Server (ห้ามใช้ localhost ถ้าจะรันบน production)
  // ต้องเป็น URL ที่เบราว์เซอร์ของผู้ใช้ทั่วไปสามารถยิงมาถึงได้
  serverUrl: 'https://b329e4682f5a4731bb28e4719291303e.apm.ap-southeast-1.aws.cloud.es.io:443',

  // 3. ใส่ Version ของแอปหน้าบ้าน (ช่วยให้คัดกรองข้อมูลเวลามีอัปเดตง่ายขึ้น)
  serviceVersion: '1.0.0',
  
  // 4. ผูกโยง Distributed Tracing เข้ากับ Backend
  // ระบุ URL ของ Backend เพื่อให้เวลาคลิกที่เว็บ แล้วยิง API ไปหลังบ้าน 
  // มันจะเชื่อมเส้นทาง (Trace) ต่อกันให้เห็นตั้งแต่ต้นจนจบใน Kibana
  distributedTracingOrigins: ['https://toteja.co', 'http://localhost:3000','http://localhost']
})
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
