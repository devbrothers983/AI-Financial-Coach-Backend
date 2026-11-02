import app from './app.js'
import dotenv from 'dotenv'
import connectDB from './config/db.js'
import { backfillActivityLog } from './utils/activityLogger.js'
import { startBankSyncSchedule } from './utils/bankSync.js'

dotenv.config()

const PORT = process.env.PORT || 5000


const startServer = async () => {

    await connectDB()

    await backfillActivityLog()

    app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server is running on port ${PORT}`)
        startBankSyncSchedule()
    })

}

startServer()