import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    key: { type: String, required: true },
    label: { type: String, default: '' },
    unit: { type: String, default: 'מנה' },
    cat: { type: String, default: 'נשנוש / ביניים' },
    // pinned to the top of the product picker popup
    starred: { type: Boolean, default: false },
    // small base64 thumbnail (data URL) of the product photo, shown in the
    // dropdown. Downscaled client-side before upload to keep documents small.
    image: { type: String, default: '' },
    carbs: { type: Number, default: 0 },
    fat: { type: Number, default: 0 },
    protein: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model('Product', productSchema);
