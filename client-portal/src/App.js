
import React, { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";
import Login from "./Login";
import Register from "./Register";
import OrderList from "./OrderList";
import NewOrder from "./NewOrder";
import DriverDashboard from "./DriverDashboard";
import "./Dashboard.css";

function App() {
  const [user, setUser] = useState(null);
  const [showRegister, setShowRegister] = useState(false);
  const [view, setView] = useState("dashboard");
  const [orderRefresh, setOrderRefresh] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);
  const socketRef = useRef(null);

  // ── Socket.io real-time connection ──────────────────────────────
  const addNotification = useCallback((notif) => {
    setNotifications(prev => [{ ...notif, id: Date.now(), read: false, timestamp: new Date().toISOString() }, ...prev].slice(0, 50));
    setToastMessage(notif.message || notif.type || 'Update received');
    setTimeout(() => setToastMessage(null), 4000);
  }, []);

  useEffect(() => {
    if (!user) {
      // Disconnect socket on logout
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    // Connect to API Gateway Socket.io (port 3000)
    const socket = io('http://localhost:3000', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });

    socket.on('connect', () => {
      console.log('🔌 Real-time connected:', socket.id);
      // Join user-specific rooms
      if (user.clientId) socket.emit('join-client', user.clientId);
      if (user.driverId) socket.emit('join-driver', user.driverId);
      socket.emit('join-user-room', user.id || user.clientId);
    });

    // Listen for order events
    socket.on('order-created', (data) => {
      addNotification({ type: 'order-created', message: `New order created: ${data.productName || data.orderId}`, data });
      setOrderRefresh(prev => prev + 1);
    });

    socket.on('order-updated', (data) => {
      addNotification({ type: 'order-updated', message: `Order updated to: ${data.status}`, data });
      setOrderRefresh(prev => prev + 1);
    });

    socket.on('order-status-changed', (data) => {
      addNotification({ type: 'status-change', message: `Order #${(data.orderId || '').slice(-6)} → ${data.status}`, data });
      setOrderRefresh(prev => prev + 1);
    });

    socket.on('delivery-completed', (data) => {
      addNotification({ type: 'delivery', message: `Delivery ${data.status}: Order #${(data.orderId || '').slice(-6)}`, data });
      setOrderRefresh(prev => prev + 1);
    });

    // SAGA events
    socket.on('saga-progress', (data) => {
      addNotification({ type: 'saga-progress', message: `SAGA Step ${data.step}: ${data.service} → ${data.status}`, data });
    });

    socket.on('saga-completed', (data) => {
      addNotification({ type: 'saga-completed', message: `Order processing complete! Tracking: ${data.trackingNumber || 'N/A'}`, data });
      setOrderRefresh(prev => prev + 1);
    });

    socket.on('saga-failed', (data) => {
      addNotification({ type: 'saga-failed', message: `Order processing failed: ${data.error}`, data });
    });

    // Delivery notifications for client
    socket.on('delivery-update', (data) => {
      addNotification({ type: 'delivery-update', message: `${data.productName}: ${data.status}`, data });
      setOrderRefresh(prev => prev + 1);
    });

    socket.on('notification', (data) => {
      addNotification({ type: data.type || 'notification', message: data.message, data });
    });

    socket.on('disconnect', (reason) => {
      console.log('🔌 Disconnected:', reason);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user, addNotification]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const handleLogin = (userData) => {
    setUser(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    setUser(null);
  };

  useEffect(() => {
    const handleShowRegister = () => setShowRegister(true);
    window.addEventListener('showRegister', handleShowRegister);
    return () => window.removeEventListener('showRegister', handleShowRegister);
  }, []);

  if (!user) {
    return (
      <div style={{ minHeight: '100vh' }}>
        {showRegister ? (
          <Register onRegister={() => setShowRegister(false)} />
        ) : (
          <Login onLogin={handleLogin} />
        )}
      </div>
    );
  }

  const isDriver = user && (user.role === 'driver' || user.role === 'Driver');

  const navItems = isDriver ? [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zm10-1a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1h-4a1 1 0 01-1-1v-5z" /></svg>
    },
    {
      id: 'deliveries',
      label: 'Deliveries',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" /></svg>
    }
  ] : [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zm10-1a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1h-4a1 1 0 01-1-1v-5z" /></svg>
    },
    {
      id: 'orders',
      label: 'My Orders',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
    },
    {
      id: 'neworder',
      label: 'New Order',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    }
  ];

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  };

  return (
    <div className="dashboard-layout">
      {/* Sidebar */}
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          {!sidebarCollapsed && <span className="sidebar-brand">Swift<strong>Logistics</strong></span>}
          <button className="sidebar-toggle" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={sidebarCollapsed ? "M13 5l7 7-7 7M5 5l7 7-7 7" : "M11 19l-7-7 7-7m8 14l-7-7 7-7"} /></svg>
          </button>
        </div>

        <nav className="sidebar-nav">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? 'active' : ''}`}
              onClick={() => setView(item.id)}
              title={item.label}
            >
              {item.icon}
              {!sidebarCollapsed && <span>{item.label}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-profile">
            <div className="user-avatar">
              {(user.name || 'U').charAt(0).toUpperCase()}
            </div>
            {!sidebarCollapsed && (
              <div className="user-info">
                <span className="user-name">{user.name}</span>
                <span className="user-role">{user.role || 'Client'}</span>
              </div>
            )}
          </div>
          <button className="logout-btn" onClick={handleLogout} title="Logout">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            {!sidebarCollapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {/* Top Bar with Notification Bell */}
        <div className="top-bar">
          <div className="top-bar-left">
            <h2 className="page-title">
              {view === 'dashboard' ? 'Dashboard' : view === 'orders' ? 'My Orders' : view === 'neworder' ? 'New Order' : view === 'deliveries' ? 'Deliveries' : 'Dashboard'}
            </h2>
          </div>
          <div className="top-bar-right">
            <div className="notif-wrapper" style={{ position: 'relative' }}>
              <button className="notif-bell-btn" onClick={() => setShowNotifPanel(!showNotifPanel)} title="Notifications">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
              </button>
              {showNotifPanel && (
                <div className="notif-panel">
                  <div className="notif-panel-header">
                    <strong>Notifications</strong>
                    {unreadCount > 0 && <button className="notif-mark-read" onClick={markAllRead}>Mark all read</button>}
                  </div>
                  <div className="notif-panel-body">
                    {notifications.length === 0 ? (
                      <div className="notif-empty">No notifications yet</div>
                    ) : notifications.map(n => (
                      <div key={n.id} className={`notif-item ${n.read ? '' : 'unread'}`}>
                        <span className={`notif-dot notif-dot-${n.type?.includes('fail') || n.type?.includes('error') ? 'red' : n.type?.includes('complet') || n.type?.includes('deliver') ? 'green' : 'blue'}`}></span>
                        <div className="notif-content">
                          <span className="notif-msg">{n.message}</span>
                          <span className="notif-time">{new Date(n.timestamp).toLocaleTimeString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Toast Notification */}
        {toastMessage && (
          <div className="toast-notification">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span>{toastMessage}</span>
          </div>
        )}

        <div className="content-wrapper">
          {view === "dashboard" && isDriver && (
            <div className="dashboard-view">
              <div className="welcome-section">
                <div className="welcome-text">
                  <h1>{getGreeting()}, {user.name}! 🚚</h1>
                  <p>Your delivery manifest for today.</p>
                </div>
              </div>

              <div className="stats-grid">
                <div className="stat-card" onClick={() => setView("deliveries")}>
                  <div className="stat-icon stat-icon-purple">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" /></svg>
                  </div>
                  <div className="stat-info">
                    <span className="stat-label">View Deliveries</span>
                    <span className="stat-desc">Manage your delivery manifest</span>
                  </div>
                  <svg className="stat-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </div>

                <div className="stat-card">
                  <div className="stat-icon stat-icon-green">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                  </div>
                  <div className="stat-info">
                    <span className="stat-label">Route Optimized</span>
                    <span className="stat-desc">AI-powered route planning</span>
                  </div>
                  <svg className="stat-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </div>

                <div className="stat-card">
                  <div className="stat-icon stat-icon-blue">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                  </div>
                  <div className="stat-info">
                    <span className="stat-label">Real-time Updates</span>
                    <span className="stat-desc">Live notifications & alerts</span>
                  </div>
                  <svg className="stat-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </div>

                <div className="stat-card">
                  <div className="stat-icon stat-icon-orange">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  </div>
                  <div className="stat-info">
                    <span className="stat-label">Priority Alerts</span>
                    <span className="stat-desc">Urgent delivery notifications</span>
                  </div>
                  <svg className="stat-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </div>
              </div>
            </div>
          )}
          {view === "dashboard" && !isDriver && (
            <div className="dashboard-view">
              <div className="welcome-section">
                <div className="welcome-text">
                  <h1>{getGreeting()}, {user.name}! 👋</h1>
                  <p>Here's what's happening with your logistics today.</p>
                </div>
              </div>

              <div className="stats-grid">
                <div className="stat-card" onClick={() => setView("orders")}>
                  <div className="stat-icon stat-icon-purple">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                  </div>
                  <div className="stat-info">
                    <span className="stat-label">View Orders</span>
                    <span className="stat-desc">Check your shipment status</span>
                  </div>
                  <svg className="stat-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </div>

                <div className="stat-card" onClick={() => setView("neworder")}>
                  <div className="stat-icon stat-icon-blue">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  </div>
                  <div className="stat-info">
                    <span className="stat-label">New Shipment</span>
                    <span className="stat-desc">Create a new delivery order</span>
                  </div>
                  <svg className="stat-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </div>

                <div className="stat-card">
                  <div className="stat-icon stat-icon-green">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                  </div>
                  <div className="stat-info">
                    <span className="stat-label">Secure Tracking</span>
                    <span className="stat-desc">Real-time shipment monitoring</span>
                  </div>
                  <svg className="stat-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </div>

                <div className="stat-card">
                  <div className="stat-icon stat-icon-orange">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  </div>
                  <div className="stat-info">
                    <span className="stat-label">Fast Delivery</span>
                    <span className="stat-desc">Express & priority shipping</span>
                  </div>
                  <svg className="stat-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </div>
              </div>
            </div>
          )}
          {view === "orders" && (
            <OrderList token={localStorage.getItem("token")} key={orderRefresh} />
          )}
          {view === "neworder" && (
            <NewOrder token={localStorage.getItem("token")} onOrderCreated={() => { setOrderRefresh(orderRefresh + 1); setView("orders"); }} />
          )}
          {view === "deliveries" && (
            <DriverDashboard token={localStorage.getItem("token")} user={user} />
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
