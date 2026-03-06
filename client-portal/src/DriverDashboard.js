import React, { useState, useEffect, useCallback, useRef } from "react";
import "./DriverDashboard.css";

function DriverDashboard({ token, user }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [failReason, setFailReason] = useState("");
  const [notification, setNotification] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);
  const canvasRef = useRef(null);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });

  const fetchOrders = useCallback(async () => {
    try {
      // Fetch driver-specific orders using driverId from user profile
      const driverId = user?.driverId || user?.userId || user?.id || '';
      const url = driverId ? `/api/orders/driver/${driverId}` : `/api/orders`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setOrders(data.orders || []);
    } catch (err) {
      console.error("Failed to fetch orders:", err);
    } finally {
      setLoading(false);
    }
  }, [token, user]);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 15000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  const updateOrderStatus = async (orderId, status, extra = {}) => {
    setUpdatingId(orderId);
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          status,
          driverId: user?.userId || user?.id || "",
          ...extra,
        }),
      });
      if (res.ok) {
        setNotification({
          type: "success",
          message: `Order marked as ${status}`,
        });
        fetchOrders();
      } else {
        setNotification({ type: "error", message: "Failed to update status" });
      }
    } catch (err) {
      setNotification({ type: "error", message: err.message });
    } finally {
      setUpdatingId(null);
      setShowSignatureModal(false);
      setFailReason("");
      setTimeout(() => setNotification(null), 3000);
    }
  };

  const handleDeliver = (order) => {
    setSelectedOrder(order);
    setShowSignatureModal(true);
    setPhotoFile(null);
  };

  // Canvas signature helpers
  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#1a1a2e";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  useEffect(() => {
    if (showSignatureModal) {
      setTimeout(initCanvas, 100);
    }
  }, [showSignatureModal, initCanvas]);

  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    if (e.touches) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startDraw = (e) => {
    isDrawingRef.current = true;
    lastPosRef.current = getPos(e, canvasRef.current);
  };

  const draw = (e) => {
    if (!isDrawingRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPosRef.current = pos;
  };

  const stopDraw = () => { isDrawingRef.current = false; };

  const clearSignature = () => { initCanvas(); };

  const getSignatureData = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.toDataURL("image/png");
  };

  const handlePhotoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setPhotoFile(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const confirmDelivery = () => {
    if (selectedOrder) {
      const signatureData = getSignatureData();
      const proofOfDelivery = photoFile
        ? `PHOTO:${photoFile.substring(0, 100)}...`
        : signatureData
          ? `SIG:${signatureData.substring(0, 100)}...`
          : `SIG-${Date.now()}`;
      updateOrderStatus(selectedOrder._id, "delivered", {
        proofOfDelivery,
      });
    }
  };

  const handleFail = (order) => {
    setSelectedOrder(order);
    setFailReason("");
    setShowSignatureModal(false);
  };

  const confirmFail = () => {
    if (selectedOrder && failReason) {
      updateOrderStatus(selectedOrder._id, "failed", { reason: failReason });
      setSelectedOrder(null);
    }
  };

  const getStatusBadge = (status) => {
    const map = {
      pending: { label: "Pending", class: "badge-pending" },
      confirmed: { label: "Confirmed", class: "badge-confirmed" },
      processing: { label: "Processing", class: "badge-processing" },
      shipped: { label: "Shipped", class: "badge-shipped" },
      out_for_delivery: { label: "Out for Delivery", class: "badge-delivery" },
      delivered: { label: "Delivered", class: "badge-delivered" },
      failed: { label: "Failed", class: "badge-failed" },
      cancelled: { label: "Cancelled", class: "badge-cancelled" },
    };
    const info = map[status] || { label: status, class: "badge-pending" };
    return <span className={`driver-badge ${info.class}`}>{info.label}</span>;
  };

  const getPriorityIcon = (priority) => {
    const map = {
      urgent: "🔴",
      high: "🟠",
      normal: "🟢",
      low: "🔵",
    };
    return map[(priority || "normal").toLowerCase()] || "🟢";
  };

  const filteredOrders = orders.filter((o) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "active")
      return ["confirmed", "processing", "shipped", "out_for_delivery"].includes(o.status);
    if (statusFilter === "completed")
      return ["delivered", "failed"].includes(o.status);
    return o.status === statusFilter;
  });

  const stats = {
    total: orders.length,
    active: orders.filter((o) =>
      ["confirmed", "processing", "shipped", "out_for_delivery"].includes(o.status)
    ).length,
    delivered: orders.filter((o) => o.status === "delivered").length,
    failed: orders.filter((o) => o.status === "failed").length,
  };

  if (loading) {
    return (
      <div className="driver-loading">
        <div className="driver-spinner"></div>
        <p>Loading delivery manifest...</p>
      </div>
    );
  }

  return (
    <div className="driver-dashboard">
      {notification && (
        <div className={`driver-notification ${notification.type}`}>
          {notification.type === "success" ? "✅" : "❌"} {notification.message}
        </div>
      )}

      <div className="driver-header">
        <h1>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="28" height="28">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
          </svg>
          Delivery Manifest
        </h1>
        <p className="driver-subtitle">
          Today's deliveries &mdash; {new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        </p>
      </div>

      {/* Stats */}
      <div className="driver-stats">
        <div className="driver-stat">
          <span className="stat-num">{stats.total}</span>
          <span className="stat-lbl">Total</span>
        </div>
        <div className="driver-stat active">
          <span className="stat-num">{stats.active}</span>
          <span className="stat-lbl">Active</span>
        </div>
        <div className="driver-stat delivered">
          <span className="stat-num">{stats.delivered}</span>
          <span className="stat-lbl">Delivered</span>
        </div>
        <div className="driver-stat failed">
          <span className="stat-num">{stats.failed}</span>
          <span className="stat-lbl">Failed</span>
        </div>
      </div>

      {/* Filters */}
      <div className="driver-filters">
        {["all", "active", "completed", "pending"].map((f) => (
          <button key={f} className={`filter-btn ${statusFilter === f ? "active" : ""}`} onClick={() => setStatusFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Orders */}
      <div className="driver-orders">
        {filteredOrders.length === 0 ? (
          <div className="driver-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="48" height="48">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <p>No deliveries found</p>
          </div>
        ) : (
          filteredOrders.map((order) => (
            <div key={order._id} className={`driver-order-card ${order.status}`}>
              <div className="order-card-header">
                <div className="order-card-left">
                  <span className="priority-icon">{getPriorityIcon(order.priority)}</span>
                  <div>
                    <h3>{order.productName}</h3>
                    <p className="order-id">#{order._id?.slice(-8)}</p>
                  </div>
                </div>
                {getStatusBadge(order.status)}
              </div>

              <div className="order-card-details">
                <div className="detail-row">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span>{order.deliveryAddress}</span>
                </div>
                <div className="detail-row">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  <span>Qty: {order.quantity}</span>
                </div>
                {order.trackingNumber && (
                  <div className="detail-row">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                    </svg>
                    <span>Tracking: {order.trackingNumber}</span>
                  </div>
                )}
                {order.packageId && (
                  <div className="detail-row">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8" />
                    </svg>
                    <span>Package: {order.packageId}</span>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              {!["delivered", "failed", "cancelled"].includes(order.status) && (
                <div className="order-card-actions">
                  {order.status === "confirmed" && (
                    <button className="action-btn pickup-btn" disabled={updatingId === order._id}
                      onClick={() => updateOrderStatus(order._id, "out_for_delivery")}>
                      {updatingId === order._id ? "..." : "🚚 Pick Up"}
                    </button>
                  )}
                  {["out_for_delivery", "shipped", "processing"].includes(order.status) && (
                    <>
                      <button className="action-btn deliver-btn" disabled={updatingId === order._id}
                        onClick={() => handleDeliver(order)}>
                        {updatingId === order._id ? "..." : "✅ Deliver"}
                      </button>
                      <button className="action-btn fail-btn" disabled={updatingId === order._id}
                        onClick={() => handleFail(order)}>
                        ❌ Failed
                      </button>
                    </>
                  )}
                  {order.status === "pending" && (
                    <button className="action-btn confirm-btn" disabled={updatingId === order._id}
                      onClick={() => updateOrderStatus(order._id, "confirmed")}>
                      {updatingId === order._id ? "..." : "✔ Confirm"}
                    </button>
                  )}
                </div>
              )}

              {order.status === "delivered" && (
                <div className="delivery-proof">
                  ✅ Delivered &mdash; {order.proofOfDelivery || "Signature captured"}
                </div>
              )}
              {order.status === "failed" && order.reason && (
                <div className="fail-reason">
                  ❌ Reason: {order.reason}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Delivery Confirmation Modal */}
      {showSignatureModal && selectedOrder && (
        <div className="modal-overlay" onClick={() => setShowSignatureModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Confirm Delivery</h3>
            <p>
              Confirm delivery for <strong>{selectedOrder.productName}</strong> to{" "}
              <strong>{selectedOrder.deliveryAddress}</strong>?
            </p>
            <div className="signature-area">
              <p style={{fontSize:'0.85rem',color:'#666',marginBottom:'8px'}}>Draw your signature below:</p>
              <canvas
                ref={canvasRef}
                width={320}
                height={150}
                style={{border:'1px solid #ccc',borderRadius:'8px',cursor:'crosshair',touchAction:'none',background:'#fff'}}
                onMouseDown={startDraw}
                onMouseMove={draw}
                onMouseUp={stopDraw}
                onMouseLeave={stopDraw}
                onTouchStart={startDraw}
                onTouchMove={draw}
                onTouchEnd={stopDraw}
              />
              <button type="button" className="action-btn" style={{marginTop:'6px',fontSize:'0.8rem',padding:'4px 12px'}} onClick={clearSignature}>
                Clear Signature
              </button>
              <div style={{marginTop:'12px'}}>
                <label style={{fontSize:'0.85rem',color:'#666'}}>Or capture a photo as proof:</label>
                <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} style={{marginTop:'4px',display:'block'}} />
                {photoFile && <p style={{color:'green',fontSize:'0.8rem',marginTop:'4px'}}>✅ Photo captured</p>}
              </div>
            </div>
            <div className="modal-actions">
              <button className="modal-btn cancel" onClick={() => setShowSignatureModal(false)}>
                Cancel
              </button>
              <button className="modal-btn confirm" onClick={confirmDelivery} disabled={updatingId}>
                {updatingId ? "Processing..." : "Confirm Delivery"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Failure Reason Modal */}
      {selectedOrder && !showSignatureModal && selectedOrder.status !== "failed" && (
        <div className="modal-overlay" onClick={() => setSelectedOrder(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Report Failed Delivery</h3>
            <p>
              Why couldn't <strong>{selectedOrder.productName}</strong> be
              delivered?
            </p>
            <div className="fail-reasons">
              {[
                "Recipient not available",
                "Wrong address",
                "Package damaged",
                "Access denied",
                "Customer refused",
              ].map((r) => (
                <button key={r} className={`reason-btn ${failReason === r ? "selected" : ""}`}
                  onClick={() => setFailReason(r)}>
                  {r}
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button className="modal-btn cancel" onClick={() => setSelectedOrder(null)}>
                Cancel
              </button>
              <button className="modal-btn fail" onClick={confirmFail} disabled={!failReason || updatingId}>
                {updatingId ? "Processing..." : "Submit Report"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DriverDashboard;
