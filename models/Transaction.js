import mongoose from 'mongoose';


const transactionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'User ID is required'],
        index: true,
    },

    transactionType: {
        type: String,
        enum: ['income', 'expense'],
        required: [true, 'Transaction type is required'],
    },
    
    transactionAmount: {
        type: Number,
        required: [true, 'Transaction amount is required'],
        min: [0.01, 'Transaction amount must be greater than 0'],

    },

    transactionCategory: {
        type: String,
        enum: [
            // expense categories
            'food', 'groceries', 'entertainment', 'transportation', 'bills',
            // income categories
            'salary', 'freelance', 'investment', 'gift',
            // shared
            'other',
        ],
        default: 'other',
        required: [true, 'Transaction category is requried'],
        trim: true,
    },
    
    description: {
        type: String,
        trim: true,
        maxlength: [200, 'Description cannot exceed 200 characters'],
        default: '',
    },

    transactionDate: {
        type: Date,
        required: [true, 'Transaction date is required'],
        default: Date.now,
    },

    paymentMethod: {
        type: String,
        enum: [
            'cash',
            'credit_card',
            'debit_card',
            'bank_transfer',
            'other',
        ],
        default: 'other',
    },
     
    isRecurring: {
        type: Boolean,
        default: false,
    },

    recurringFrequency: {
        type: String,
        enum: ['daily', 'weekly', 'monthly', 'yearly'],

    },

    transactionNotes: {
        type: String,
        trim: true,
        maxlength: [500, 'Notes cannot exceed 500 characters'],
        default: '',
    },


}, 
{ timestamps: true }
 
);

transactionSchema.index({userId: 1, transactionDate: -1})

const Transaction = mongoose.model('Transaction', transactionSchema);

export default Transaction;