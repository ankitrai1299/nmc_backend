import mongoose from 'mongoose';

const AuditRecordSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  contentType: {
    type: String,
    enum: ['text', 'url', 'webpage', 'image', 'video', 'audio', 'document'],
    required: true
  },
  originalInput: {
    type: String,
    required: true
  },
  extractedText: {
    type: String,
    default: ''
  },
  transcript: {
    type: String,
    default: ''
  },
  auditResult: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

AuditRecordSchema.index({ createdAt: -1 });
AuditRecordSchema.index({ contentType: 1 });
AuditRecordSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('AuditRecord', AuditRecordSchema);
