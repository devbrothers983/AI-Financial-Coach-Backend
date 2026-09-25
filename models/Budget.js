import mongoose from "mongoose";

const budgetSchema = new mongoose.Schema({
    userId:{
        type:mongoose.Schema.Types.ObjectId,
        required:true,
        ref:"User",
        index:true
    },
    month:{
        type:Number,
        required:true,
        min:1,
        max:12
    },
    year:{
        type:Number,
        required:true,

    },
    totalBudget:{
        type:Number,
        required:true,
        min:0,

    },
    categories:[
        {
            category:{
                type:String,
                required:true,
                trim:true,
            },
            limit:{
                type:Number,
                required:true,
                min:0
            },
        },
    ],
    linkedGoal:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"Goal",
        default:null,
    },
    swept:{
        type:Boolean,
        default:false,
    },
    sweptAmount:{
        type:Number,
        default:0,
    },
},{timestamps:true});

// prevent dupllicat budget for same user/month/year

budgetSchema.index({userId:1,year:1,month:1},{unique:true})
const Budget = mongoose.model("Budget",budgetSchema);
export default Budget;