import React, { useState } from 'react';
import './NewOrder.css';

function NewOrder({ token, onOrderCreated }) {
  const [form, setForm] = useState({
    productName: '',
    quantity: 1,
    deliveryAddress: '',
    priority: 'Normal',
    description: ''
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  const handleChange = e => {
    setForm({ ...form, [e.target.name]: e.target.value });
    // Clear field error when user types
    if (fieldErrors[e.target.name]) {
      setFieldErrors(prev => { const next = { ...prev }; delete next[e.target.name]; return next; });
    }
  };

  // Client-side validation
  const validateForm = () => {
    const errors = {};
    if (!form.productName.trim()) errors.productName = 'Product name is required';
    else if (form.productName.trim().length > 200) errors.productName = 'Product name must be under 200 characters';
    if (!form.quantity || form.quantity < 1) errors.quantity = 'Quantity must be at least 1';
    if (!form.deliveryAddress.trim()) errors.deliveryAddress = 'Delivery address is required';
    else if (form.deliveryAddress.trim().length > 500) errors.deliveryAddress = 'Address must be under 500 characters';
    if (form.description && form.description.length > 1000) errors.description = 'Description must be under 1000 characters';
    return errors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setSuccess(''); setFieldErrors({});
    
    // Client-side validation first
    const clientErrors = validateForm();
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      setError('Please fix the highlighted fields');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess('Order created successfully!');
        setForm({ productName: '', quantity: 1, deliveryAddress: '', priority: 'Normal', description: '' });
        setFieldErrors({});
        setTimeout(() => { onOrderCreated && onOrderCreated(); }, 1500);
      } else {
        // Parse server-side field errors
        if (data.details && Array.isArray(data.details)) {
          const serverFieldErrors = {};
          data.details.forEach(d => {
            if (d.field) serverFieldErrors[d.field] = d.message;
          });
          if (Object.keys(serverFieldErrors).length > 0) {
            setFieldErrors(serverFieldErrors);
          }
        }
        setError(data.error || 'Failed to create order');
      }
    } catch (err) {
      setError('Network error. Please check your connection.');
    }
    setLoading(false);
  };

  const priorities = [
    { value: 'Low', label: 'Low', color: '#16a34a', bg: '#f0fdf4', icon: '●' },
    { value: 'Normal', label: 'Normal', color: '#4f46e5', bg: '#eef2ff', icon: '●' },
    { value: 'High', label: 'High', color: '#ea580c', bg: '#fff7ed', icon: '●' },
    { value: 'Urgent', label: 'Urgent', color: '#dc2626', bg: '#fef2f2', icon: '●' }
  ];

  return (
    <div className="new-order-section">
      <div className="new-order-card">
        <div className="new-order-header">
          <div className="new-order-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h2 className="new-order-title">Create New Order</h2>
            <p className="new-order-subtitle">Fill in the details to create a new shipment</p>
          </div>
        </div>

        {error && (
          <div className="no-alert no-alert-error">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="no-alert no-alert-success">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
            <span>{success}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="new-order-form">
          <div className="no-form-row">
            <div className="no-form-group">
              <label className="no-form-label">Product Name</label>
              <div className="no-input-wrapper">
                <svg className="no-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                <input name="productName" className={`no-form-input ${fieldErrors.productName ? 'error' : ''}`} placeholder="Enter product name" value={form.productName} onChange={handleChange} required disabled={loading} />
              </div>
              {fieldErrors.productName && <span className="field-error">{fieldErrors.productName}</span>}
            </div>
            <div className="no-form-group no-form-group-small">
              <label className="no-form-label">Quantity</label>
              <div className="no-input-wrapper">
                <svg className="no-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                </svg>
                <input name="quantity" type="number" min="1" className={`no-form-input ${fieldErrors.quantity ? 'error' : ''}`} placeholder="1" value={form.quantity} onChange={handleChange} required disabled={loading} />
              </div>
              {fieldErrors.quantity && <span className="field-error">{fieldErrors.quantity}</span>}
            </div>
          </div>

          <div className="no-form-group">
            <label className="no-form-label">Delivery Address</label>
            <div className="no-input-wrapper">
              <svg className="no-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <input name="deliveryAddress" className={`no-form-input ${fieldErrors.deliveryAddress ? 'error' : ''}`} placeholder="Full delivery address" value={form.deliveryAddress} onChange={handleChange} required disabled={loading} />
            </div>
            {fieldErrors.deliveryAddress && <span className="field-error">{fieldErrors.deliveryAddress}</span>}
          </div>

          <div className="no-form-group">
            <label className="no-form-label">Priority Level</label>
            <div className="priority-selector">
              {priorities.map(p => (
                <label key={p.value} className={`priority-option ${form.priority === p.value ? 'active' : ''}`} style={{ '--p-color': p.color, '--p-bg': p.bg }}>
                  <input type="radio" name="priority" value={p.value} checked={form.priority === p.value} onChange={handleChange} />
                  <span className="priority-dot" style={{ background: p.color }}></span>
                  <span>{p.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="no-form-group">
            <label className="no-form-label">Description <span className="optional-tag">Optional</span></label>
            <div className="no-input-wrapper no-textarea-wrapper">
              <svg className="no-input-icon no-textarea-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
              </svg>
              <textarea name="description" className={`no-form-input no-form-textarea ${fieldErrors.description ? 'error' : ''}`} placeholder="Additional instructions or notes..." value={form.description} onChange={handleChange} disabled={loading} rows="3" />
            </div>
            {fieldErrors.description && <span className="field-error">{fieldErrors.description}</span>}
          </div>

          <button type="submit" className="submit-order-btn" disabled={loading}>
            {loading ? (
              <>
                <svg className="no-spinner" viewBox="0 0 24 24"><circle className="no-spinner-circle" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /></svg>
                Creating order...
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                Submit Order
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

export default NewOrder;
