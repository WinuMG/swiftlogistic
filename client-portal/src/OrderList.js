import React, { useEffect, useState, useCallback } from 'react';
import './OrderList.css';

function OrderList({ token }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedProofs, setExpandedProofs] = useState({});

  const toggleProof = useCallback((orderId) => {
    setExpandedProofs(prev => ({ ...prev, [orderId]: !prev[orderId] }));
  }, []);

  useEffect(() => {
    const fetchOrders = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch('/api/orders', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (res.ok) {
          setOrders(data.orders || []);
        } else {
          setError(data.error || 'Failed to fetch orders');
        }
      } catch (err) {
        setError('Network error. Please check your connection.');
      }
      setLoading(false);
    };
    fetchOrders();
  }, [token]);

  const getStatusConfig = (status) => {
    const s = (status || '').toLowerCase();
    if (s === 'delivered' || s === 'completed') return { class: 'status-success', icon: '✓', label: status };
    if (s === 'in_transit' || s === 'shipped' || s === 'in transit') return { class: 'status-transit', icon: '🚚', label: status };
    if (s === 'processing') return { class: 'status-processing', icon: '⚙', label: status };
    if (s === 'cancelled' || s === 'failed') return { class: 'status-cancelled', icon: '✕', label: status };
    return { class: 'status-pending', icon: '◷', label: status || 'Pending' };
  };

  const getPriorityClass = (priority) => {
    const p = (priority || '').toLowerCase();
    if (p === 'urgent') return 'priority-urgent';
    if (p === 'high') return 'priority-high';
    if (p === 'low') return 'priority-low';
    return 'priority-normal';
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (loading) {
    return (
      <div className="orders-section">
        <div className="orders-header">
          <h2 className="orders-title">My Orders</h2>
        </div>
        <div className="orders-loading">
          {[1,2,3].map(i => (
            <div key={i} className="skeleton-card">
              <div className="skeleton-line wide"></div>
              <div className="skeleton-line medium"></div>
              <div className="skeleton-line narrow"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="orders-section">
        <div className="orders-header">
          <h2 className="orders-title">My Orders</h2>
        </div>
        <div className="orders-error">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10" strokeWidth="2"/><path strokeLinecap="round" strokeWidth="2" d="M12 8v4m0 4h.01"/></svg>
          <h3>Something went wrong</h3>
          <p>{error}</p>
          <button className="retry-btn" onClick={() => window.location.reload()}>Try Again</button>
        </div>
      </div>
    );
  }

  if (!orders.length) {
    return (
      <div className="orders-section">
        <div className="orders-header">
          <h2 className="orders-title">My Orders</h2>
        </div>
        <div className="orders-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
          <h3>No orders yet</h3>
          <p>Your orders will appear here once you create one.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="orders-section">
      <div className="orders-header">
        <h2 className="orders-title">My Orders</h2>
        <span className="orders-count">{orders.length} order{orders.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="orders-grid">
        {orders.map((order, idx) => {
          const statusConfig = getStatusConfig(order.status);
          return (
            <div className="order-card" key={order._id || order.id} style={{ animationDelay: `${idx * 0.05}s` }}>
              <div className="order-card-top">
                <div className="order-id">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>
                  <span>#{(order._id || order.id || '').slice(-6).toUpperCase()}</span>
                </div>
                <span className={`status-badge ${statusConfig.class}`}>
                  <span className="status-dot"></span>
                  {statusConfig.label}
                </span>
              </div>

              <div className="order-card-body">
                <h3 className="order-product">{order.productName || 'Shipment'}</h3>
                <p className="order-desc">{order.description || 'No description provided'}</p>
              </div>

              <div className="order-card-details">
                {order.quantity && (
                  <div className="detail-item">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                    <span>Qty: {order.quantity}</span>
                  </div>
                )}
                {order.deliveryAddress && (
                  <div className="detail-item">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    <span>{order.deliveryAddress}</span>
                  </div>
                )}
                {order.priority && (
                  <div className="detail-item">
                    <span className={`priority-badge ${getPriorityClass(order.priority)}`}>{order.priority}</span>
                  </div>
                )}
              </div>

              {/* Proof of Delivery / Failure Reason */}
              {(order.status === 'delivered' || order.status === 'completed') && order.proofOfDelivery && (
                <div className="proof-of-delivery proof-success">
                  <button className="proof-toggle" onClick={() => toggleProof(order._id || order.id)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <span>Proof of Delivery</span>
                    <svg className={`proof-chevron ${expandedProofs[order._id || order.id] ? 'open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  {expandedProofs[order._id || order.id] && (
                    <div className="proof-content">
                      {order.proofOfDelivery.signature && (
                        <div className="proof-item">
                          <span className="proof-label">Signature</span>
                          <img className="proof-signature" src={order.proofOfDelivery.signature} alt="Delivery signature" />
                        </div>
                      )}
                      {order.proofOfDelivery.photo && (
                        <div className="proof-item">
                          <span className="proof-label">Photo</span>
                          <img className="proof-photo" src={order.proofOfDelivery.photo} alt="Delivery photo" />
                        </div>
                      )}
                      {order.proofOfDelivery.deliveredAt && (
                        <div className="proof-item">
                          <span className="proof-label">Delivered</span>
                          <span className="proof-value">{formatDate(order.proofOfDelivery.deliveredAt)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {(order.status === 'failed' || order.status === 'cancelled') && order.reason && (
                <div className="proof-of-delivery proof-failure">
                  <div className="proof-failure-banner">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <span>Reason: {order.reason}</span>
                  </div>
                </div>
              )}

              <div className="order-card-footer">
                {order.createdAt && (
                  <span className="order-date">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    {formatDate(order.createdAt)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default OrderList;
