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

    // Bank imports (Plaid); everything else is entered by hand or from a CSV
    source: {
        type: String,
        enum: ['manual', 'bank'],
        default: 'manual',
    },
    plaidTransactionId: {
        type: String,
    },
    bankConnectionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'BankConnection',
        default: null,
    },
    bankAccountName: {
        type: String,
        default: '',
    },
    isPending: {
        type: Boolean,
        default: false,
    },
    // a manual entry that looks like the same purchase, for the user to review
    possibleDuplicateOf: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Transaction',
        default: null,
    },
    // set when a tracked subscription added this expense automatically
    subscriptionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Subscription',
        default: null,
    },


}, 
{ timestamps: true }
 
);

transactionSchema.index({userId: 1, transactionDate: -1})
// a subscription can only add one expense per charge date
transactionSchema.index(
    { subscriptionId: 1, transactionDate: 1 },
    { unique: true, partialFilterExpression: { subscriptionId: { $type: 'objectId' } } }
)
// a bank transaction can only be imported once
transactionSchema.index(
    { userId: 1, plaidTransactionId: 1 },
    { unique: true, partialFilterExpression: { plaidTransactionId: { $type: 'string' } } }
)

const Transaction = mongoose.model('Transaction', transactionSchema);

export default Transaction;