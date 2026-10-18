import app from './app.js'
import dotenv from 'dotenv'
import connectDB from './config/db.js'

dotenv.config()

const PORT = process.env.PORT || 5000


const startServer = async () => {

    await connectDB()

    app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server is running on port ${PORT}`)
    })

}

startServer()