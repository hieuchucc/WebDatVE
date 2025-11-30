const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const ROLES = ['admin', 'employee', 'customer'];

const UserSchema = new Schema({
  username:     { type: String, required: true, unique: true, lowercase: true, trim: true },
  displayName:  { type: String, trim: true },
  email: { type: String, lowercase: true, trim: true, unique: true, sparse: true },
  phone:        { type: String, trim: true },                  
  passwordHash: { type: String, required: true },
  role:         { type: String, enum: ROLES, default: 'customer', index: true },
  isSystem:     { type: Boolean, default: false, immutable: true },
}, { timestamps: true });


// Chặn hạ quyền admin hệ thống
UserSchema.pre(['findOneAndUpdate','updateOne','updateMany'], async function(next){
  const role = this.getUpdate()?.role ?? this.getUpdate()?.$set?.role;
  if (!role) return next();
  const target = await this.model.findOne(this.getFilter()).lean();
  if (target?.isSystem && role !== 'admin') {
    return next(new Error('Cannot change role of system admin'));
  }
  next();
});

// Chặn xoá admin hệ thống
UserSchema.pre(['deleteOne','deleteMany','findOneAndDelete','findByIdAndDelete'], async function(next){
  const target = await this.model.findOne(this.getFilter()).lean();
  if (target?.isSystem) return next(new Error('Cannot delete system admin'));
  next();
});

module.exports = { User: mongoose.model('User', UserSchema), ROLES };
