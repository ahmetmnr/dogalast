/**
 * Admin Dashboard Component
 * Real-time admin dashboard with system metrics and analytics
 */

import { webSocketManager, WebSocketEventHelper } from '../core/WebSocketManager.ts';
import { api } from '../core/ApiClient.ts';

export class AdminDashboard {
  constructor(containerId, adminUser) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Admin dashboard container not found: ${containerId}`);
    }

    this.adminUser = adminUser;
    this.stats = null;
    this.isLoading = true;
    this.error = null;
    this.lastUpdateTime = new Date();
    this.autoRefresh = true;
    this.cleanupFunctions = [];
    
    this.render();
    this.setupEventListeners();
    this.loadDashboardStats();
  }

  /**
   * Load dashboard statistics
   */
  async loadDashboardStats() {
    try {
      this.isLoading = true;
      this.error = null;
      this.updateLoadingState();

      const response = await api.admin.getDashboardStats();

      if (response.success && response.data) {
        this.stats = response.data;
        this.lastUpdateTime = new Date();
        this.renderDashboard();
      } else {
        throw new Error(response.error?.message || 'Dashboard verileri yüklenemedi');
      }

    } catch (error) {
      console.error('Failed to load dashboard stats:', error);
      this.error = error.message || 'Dashboard yüklenirken hata oluştu';
      this.renderError();
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Handle real-time updates
   */
  handleRealtimeUpdate(updateData) {
    if (updateData.type === 'dashboard_stats') {
      this.stats = this.stats ? { ...this.stats, ...updateData.data } : updateData.data;
      this.lastUpdateTime = new Date();
      this.renderDashboard();
    } else if (updateData.type === 'system_alert') {
      this.showSystemAlert(updateData.message, updateData.severity);
    }
  }

  /**
   * Setup WebSocket event listeners
   */
  setupEventListeners() {
    if (this.autoRefresh) {
      // Setup real-time updates
      const adminCleanup = WebSocketEventHelper.setupAdminUpdates(
        (data) => this.handleRealtimeUpdate(data),
        (error) => console.error('Admin update error:', error)
      );
      this.cleanupFunctions.push(adminCleanup);
    }

    // Auto-refresh timer
    if (this.autoRefresh) {
      const interval = setInterval(() => {
        this.loadDashboardStats();
      }, 30000); // Refresh every 30 seconds

      this.cleanupFunctions.push(() => clearInterval(interval));
    }
  }

  /**
   * Format numbers for display
   */
  formatNumber(num) {
    return num.toLocaleString('tr-TR');
  }

  /**
   * Format percentage
   */
  formatPercentage(num) {
    return `%${(num * 100).toFixed(1)}`;
  }

  /**
   * Format duration
   */
  formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}s ${minutes}dk ${secs}sn`;
    } else if (minutes > 0) {
      return `${minutes}dk ${secs}sn`;
    } else {
      return `${secs}sn`;
    }
  }

  /**
   * Get system health status
   */
  getSystemHealthStatus(health) {
    const issues = [];

    if (health.responseTime > 1000) issues.push('Yavaş yanıt süresi');
    if (health.errorRate > 0.05) issues.push('Yüksek hata oranı');
    if (health.memoryUsage > 0.8) issues.push('Yüksek bellek kullanımı');
    if (health.cpuUsage > 0.8) issues.push('Yüksek CPU kullanımı');

    if (issues.length === 0) {
      return { status: 'healthy', message: 'Sistem sağlıklı', color: 'success' };
    } else if (issues.length <= 2) {
      return { status: 'warning', message: `Uyarı: ${issues.join(', ')}`, color: 'warning' };
    } else {
      return { status: 'critical', message: `Kritik: ${issues.join(', ')}`, color: 'error' };
    }
  }

  /**
   * Show system alert
   */
  showSystemAlert(message, severity = 'info') {
    const alertContainer = this.container.querySelector('.system-alerts');
    if (!alertContainer) return;

    const alert = document.createElement('div');
    alert.className = `system-alert ${severity}`;
    alert.innerHTML = `
      <div class="alert-content">
        <span class="alert-icon">
          ${severity === 'error' ? '🚨' : severity === 'warning' ? '⚠️' : 'ℹ️'}
        </span>
        <span class="alert-message">${message}</span>
        <button class="alert-close" onclick="this.parentElement.parentElement.remove()">✕</button>
      </div>
    `;

    alertContainer.appendChild(alert);

    // Auto-remove after 10 seconds
    setTimeout(() => {
      if (alert.parentElement) {
        alert.remove();
      }
    }, 10000);
  }

  /**
   * Render admin dashboard
   */
  render() {
    this.container.innerHTML = `
      <div class="admin-dashboard">
        <!-- System Alerts -->
        <div class="system-alerts"></div>
        
        <!-- Dashboard Header -->
        <div class="dashboard-header">
          <div class="header-content">
            <h1 class="dashboard-title">
              🏠 Admin Dashboard
            </h1>
            
            <div class="header-info">
              <span class="admin-welcome">
                Hoş geldin, ${this.adminUser.username}
              </span>
              <span class="admin-role">
                ${this.adminUser.role === 'super_admin' ? '👑 Süper Admin' : '🛡️ Admin'}
              </span>
            </div>
          </div>
          
          <div class="header-controls">
            <div class="last-update">
              Son güncelleme: <span class="update-time">${this.lastUpdateTime.toLocaleTimeString('tr-TR')}</span>
            </div>
            
            <label class="auto-refresh-toggle">
              <input type="checkbox" class="refresh-checkbox" ${this.autoRefresh ? 'checked' : ''}>
              <span>Otomatik yenile</span>
            </label>
            
            <button class="btn btn-outline refresh-btn">
              <span class="refresh-icon">↻</span> Yenile
            </button>
          </div>
        </div>
        
        <!-- Dashboard Content -->
        <div class="dashboard-content">
          <!-- Content will be rendered here -->
        </div>
      </div>
    `;

    // Bind event handlers
    this.bindEventHandlers();
  }

  /**
   * Bind event handlers
   */
  bindEventHandlers() {
    // Refresh button
    const refreshBtn = this.container.querySelector('.refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.loadDashboardStats());
    }

    // Auto-refresh toggle
    const refreshCheckbox = this.container.querySelector('.refresh-checkbox');
    if (refreshCheckbox) {
      refreshCheckbox.addEventListener('change', (e) => {
        this.autoRefresh = e.target.checked;
        if (this.autoRefresh) {
          this.setupEventListeners();
        } else {
          this.cleanupFunctions.forEach(cleanup => cleanup());
          this.cleanupFunctions = [];
        }
      });
    }
  }

  /**
   * Update loading state
   */
  updateLoadingState() {
    const contentArea = this.container.querySelector('.dashboard-content');
    if (!contentArea) return;

    if (this.isLoading && !this.stats) {
      contentArea.innerHTML = `
        <div class="dashboard-loading">
          <div class="loading"></div>
          <span>Dashboard yükleniyor...</span>
        </div>
      `;
    }
  }

  /**
   * Render dashboard content
   */
  renderDashboard() {
    if (!this.stats) return;

    const contentArea = this.container.querySelector('.dashboard-content');
    if (!contentArea) return;

    const systemHealth = this.getSystemHealthStatus(this.stats.systemHealth);

    contentArea.innerHTML = `
      <!-- KPI Cards -->
      <div class="kpi-grid">
        <div class="kpi-card participants">
          <div class="kpi-header">
            <span class="kpi-icon">👥</span>
            <span class="kpi-title">Toplam Katılımcı</span>
          </div>
          <div class="kpi-value">${this.formatNumber(this.stats.totalParticipants)}</div>
          <div class="kpi-subtitle">
            ${this.formatNumber(this.stats.activeUsers)} aktif kullanıcı
          </div>
        </div>
        
        <div class="kpi-card sessions">
          <div class="kpi-header">
            <span class="kpi-icon">🎯</span>
            <span class="kpi-title">Quiz Oturumları</span>
          </div>
          <div class="kpi-value">${this.formatNumber(this.stats.totalQuizSessions)}</div>
          <div class="kpi-subtitle">
            ${this.formatNumber(this.stats.completedQuizzes)} tamamlandı
          </div>
        </div>
        
        <div class="kpi-card performance">
          <div class="kpi-header">
            <span class="kpi-icon">📊</span>
            <span class="kpi-title">Ortalama Puan</span>
          </div>
          <div class="kpi-value">${this.formatNumber(this.stats.averageScore)}</div>
          <div class="kpi-subtitle">
            Ort. süre: ${this.formatDuration(this.stats.averageCompletionTime)}
          </div>
        </div>
        
        <div class="kpi-card system-health">
          <div class="kpi-header">
            <span class="kpi-icon">💚</span>
            <span class="kpi-title">Sistem Durumu</span>
          </div>
          <div class="kpi-value ${systemHealth.color}">
            ${systemHealth.status === 'healthy' ? '✅' : 
              systemHealth.status === 'warning' ? '⚠️' : '🚨'}
          </div>
          <div class="kpi-subtitle">
            ${systemHealth.message}
          </div>
        </div>
      </div>
      
      <!-- Charts and Analytics -->
      <div class="dashboard-grid">
        <!-- System Health Details -->
        <div class="dashboard-card system-metrics">
          <div class="card-header">
            <h3 class="card-title">🔧 Sistem Metrikleri</h3>
          </div>
          <div class="card-body">
            <div class="metrics-grid">
              <div class="metric-item">
                <span class="metric-label">Çalışma Süresi</span>
                <span class="metric-value">
                  ${this.formatDuration(this.stats.systemHealth.uptime)}
                </span>
              </div>
              
              <div class="metric-item">
                <span class="metric-label">Yanıt Süresi</span>
                <span class="metric-value">
                  ${this.stats.systemHealth.responseTime}ms
                </span>
              </div>
              
              <div class="metric-item">
                <span class="metric-label">Hata Oranı</span>
                <span class="metric-value">
                  ${this.formatPercentage(this.stats.systemHealth.errorRate)}
                </span>
              </div>
              
              <div class="metric-item">
                <span class="metric-label">Bellek Kullanımı</span>
                <span class="metric-value">
                  ${this.formatPercentage(this.stats.systemHealth.memoryUsage)}
                </span>
              </div>
              
              <div class="metric-item">
                <span class="metric-label">CPU Kullanımı</span>
                <span class="metric-value">
                  ${this.formatPercentage(this.stats.systemHealth.cpuUsage)}
                </span>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Top Performers -->
        <div class="dashboard-card top-performers">
          <div class="card-header">
            <h3 class="card-title">🏆 En İyi Performans</h3>
          </div>
          <div class="card-body">
            <div class="performers-list">
              ${this.stats.topPerformers.map((performer, index) => `
                <div class="performer-item">
                  <div class="performer-rank">
                    ${index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}
                  </div>
                  <div class="performer-info">
                    <span class="performer-name">${performer.name}</span>
                    <span class="performer-details">
                      ${this.formatNumber(performer.score)} puan • ${this.formatDuration(performer.completionTime)}
                    </span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
        
        <!-- Recent Activity -->
        <div class="dashboard-card recent-activity">
          <div class="card-header">
            <h3 class="card-title">📋 Son Aktiviteler</h3>
          </div>
          <div class="card-body">
            <div class="activity-list">
              ${this.stats.recentActivity.map((activity) => `
                <div class="activity-item">
                  <div class="activity-icon">
                    ${activity.type === 'registration' ? '👤' :
                      activity.type === 'quiz_start' ? '🎯' :
                      activity.type === 'quiz_complete' ? '✅' :
                      activity.type === 'admin_action' ? '🛡️' : '📝'}
                  </div>
                  <div class="activity-content">
                    <span class="activity-description">
                      ${activity.description}
                    </span>
                    <span class="activity-time">
                      ${new Date(activity.timestamp).toLocaleString('tr-TR')}
                    </span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
      
      <!-- Quick Actions -->
      <div class="dashboard-actions">
        <div class="actions-header">
          <h3>⚡ Hızlı İşlemler</h3>
        </div>
        
        <div class="actions-grid">
          <button class="action-btn questions" data-action="questions">
            <span class="action-icon">❓</span>
            <span class="action-text">Soru Yönetimi</span>
          </button>
          
          <button class="action-btn users" data-action="users">
            <span class="action-icon">👥</span>
            <span class="action-text">Kullanıcı Yönetimi</span>
          </button>
          
          <button class="action-btn analytics" data-action="analytics">
            <span class="action-icon">📊</span>
            <span class="action-text">Detaylı Analitik</span>
          </button>
          
          <button class="action-btn settings" data-action="settings">
            <span class="action-icon">⚙️</span>
            <span class="action-text">Sistem Ayarları</span>
          </button>
          
          <button class="action-btn export" data-action="export">
            <span class="action-icon">📄</span>
            <span class="action-text">Rapor İndir</span>
          </button>
          
          <button class="action-btn logs" data-action="logs">
            <span class="action-icon">📝</span>
            <span class="action-text">Sistem Logları</span>
          </button>
        </div>
      </div>
    `;

    // Update last update time
    const updateTimeElement = this.container.querySelector('.update-time');
    if (updateTimeElement) {
      updateTimeElement.textContent = this.lastUpdateTime.toLocaleTimeString('tr-TR');
    }

    // Bind quick action handlers
    this.bindQuickActionHandlers();
  }

  /**
   * Bind quick action handlers
   */
  bindQuickActionHandlers() {
    const actionButtons = this.container.querySelectorAll('.action-btn');
    
    actionButtons.forEach(button => {
      button.addEventListener('click', () => {
        const action = button.getAttribute('data-action');
        this.handleQuickAction(action);
      });
    });
  }

  /**
   * Handle quick action clicks
   */
  handleQuickAction(action) {
    switch (action) {
      case 'questions':
        this.navigateToQuestionManagement();
        break;
      case 'users':
        this.navigateToUserManagement();
        break;
      case 'analytics':
        this.navigateToAnalytics();
        break;
      case 'settings':
        this.navigateToSettings();
        break;
      case 'export':
        this.showExportDialog();
        break;
      case 'logs':
        this.navigateToLogs();
        break;
      default:
        console.log(`Unknown action: ${action}`);
    }
  }

  /**
   * Navigation methods
   */
  navigateToQuestionManagement() {
    // Trigger navigation event or direct navigation
    window.dispatchEvent(new CustomEvent('admin-navigate', {
      detail: { page: 'questions' }
    }));
  }

  navigateToUserManagement() {
    window.dispatchEvent(new CustomEvent('admin-navigate', {
      detail: { page: 'users' }
    }));
  }

  navigateToAnalytics() {
    window.dispatchEvent(new CustomEvent('admin-navigate', {
      detail: { page: 'analytics' }
    }));
  }

  navigateToSettings() {
    window.dispatchEvent(new CustomEvent('admin-navigate', {
      detail: { page: 'settings' }
    }));
  }

  navigateToLogs() {
    window.dispatchEvent(new CustomEvent('admin-navigate', {
      detail: { page: 'logs' }
    }));
  }

  showExportDialog() {
    // Show export options modal
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal export-modal">
        <div class="modal-header">
          <h3>📄 Rapor İndir</h3>
          <button class="modal-close">✕</button>
        </div>
        <div class="modal-body">
          <p>İndirmek istediğiniz rapor türünü seçin:</p>
          <div class="export-options">
            <button class="btn btn-outline" data-format="pdf">📄 PDF Raporu</button>
            <button class="btn btn-outline" data-format="excel">📊 Excel Raporu</button>
            <button class="btn btn-outline" data-format="csv">📋 CSV Verileri</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Handle export format selection
    modal.querySelectorAll('[data-format]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const format = e.target.getAttribute('data-format');
        await this.exportReport(format);
        modal.remove();
      });
    });

    // Handle close
    modal.querySelector('.modal-close').addEventListener('click', () => {
      modal.remove();
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  }

  /**
   * Export report
   */
  async exportReport(format) {
    try {
      const response = await api.admin.exportDashboardReport(format);
      
      if (response.success && response.data) {
        // Create download
        const blob = new Blob([response.data], {
          type: format === 'pdf' ? 'application/pdf' : 'application/octet-stream'
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `dashboard-report-${new Date().toISOString().split('T')[0]}.${format}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        this.showSystemAlert('Rapor başarıyla indirildi', 'success');
      } else {
        throw new Error(response.error?.message || 'Rapor oluşturulamadı');
      }
    } catch (error) {
      console.error('Export failed:', error);
      this.showSystemAlert(`Rapor indirme hatası: ${error.message}`, 'error');
    }
  }

  /**
   * Render error state
   */
  renderError() {
    const contentArea = this.container.querySelector('.dashboard-content');
    if (!contentArea) return;

    contentArea.innerHTML = `
      <div class="dashboard-error">
        <div class="error-content">
          <span class="error-icon">⚠️</span>
          <h2 class="error-title">Dashboard Yüklenemedi</h2>
          <p class="error-message">${this.error}</p>
          <button class="btn btn-primary retry-btn">
            Tekrar Dene
          </button>
        </div>
      </div>
    `;

    // Bind retry button
    const retryBtn = contentArea.querySelector('.retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => this.loadDashboardStats());
    }
  }

  /**
   * Get dashboard statistics
   */
  getStats() {
    return this.stats;
  }

  /**
   * Refresh dashboard
   */
  async refresh() {
    await this.loadDashboardStats();
  }

  /**
   * Cleanup component
   */
  cleanup() {
    // Run cleanup functions
    this.cleanupFunctions.forEach(cleanup => cleanup());
    this.cleanupFunctions = [];

    console.log('Admin dashboard cleaned up');
  }
}

export default AdminDashboard;
