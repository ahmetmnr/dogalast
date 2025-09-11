/**
 * Leaderboard Component
 * Real-time leaderboard with WebSocket updates and animations
 */

import { webSocketManager, WebSocketEventHelper } from '../core/WebSocketManager.ts';
import { api } from '../core/ApiClient.ts';

export class Leaderboard {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Leaderboard container not found: ${containerId}`);
    }

    this.options = {
      pageSize: 20,
      autoRefresh: true,
      showFullStats: false,
      currentUserId: null,
      ...options
    };

    this.entries = [];
    this.isLoading = false;
    this.error = null;
    this.currentPage = 0;
    this.totalEntries = 0;
    this.hasMore = false;
    this.lastUpdateTime = null;
    this.cleanupFunctions = [];
    
    this.render();
    this.setupEventListeners();
    this.loadLeaderboard();
  }

  /**
   * Load leaderboard data from API
   */
  async loadLeaderboard(page = 0, append = false) {
    try {
      if (!append) {
        this.isLoading = true;
        this.error = null;
        this.updateLoadingState();
      }

      const response = await api.leaderboard.get(this.options.pageSize, page * this.options.pageSize);

      if (response.success && response.data) {
        const newEntries = response.data.leaderboard.map(entry => ({
          ...entry,
          animationKey: `${entry.participantId}-${entry.score}-${entry.rank}`,
          completedAt: new Date(entry.completedAt)
        }));

        if (append) {
          this.entries = [...this.entries, ...newEntries];
        } else {
          this.entries = newEntries;
        }

        this.totalEntries = response.data.pagination.total;
        this.hasMore = response.data.pagination.hasMore;
        this.currentPage = page;
        this.lastUpdateTime = new Date();

        this.renderEntries();

      } else {
        throw new Error(response.error?.message || 'Liderlik tablosu yüklenemedi');
      }

    } catch (error) {
      console.error('Failed to load leaderboard:', error);
      this.error = error.message || 'Liderlik tablosu yüklenirken hata oluştu';
      this.renderError();
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Handle real-time leaderboard updates
   */
  handleLeaderboardUpdate(updateData) {
    const { updatedEntry, newRankings } = updateData;

    if (newRankings && Array.isArray(newRankings)) {
      // Full leaderboard update
      const updatedEntries = newRankings.map(entry => {
        const existingEntry = this.entries.find(e => e.participantId === entry.participantId);
        
        return {
          ...entry,
          isNew: !existingEntry,
          isUpdated: existingEntry && existingEntry.score !== entry.score,
          previousRank: existingEntry?.rank,
          animationKey: `${entry.participantId}-${entry.score}-${entry.rank}`,
          completedAt: new Date(entry.completedAt)
        };
      });

      this.entries = updatedEntries;
      
    } else if (updatedEntry) {
      // Single entry update
      const existingIndex = this.entries.findIndex(e => e.participantId === updatedEntry.participantId);
      
      if (existingIndex >= 0) {
        // Update existing entry
        this.entries[existingIndex] = {
          ...updatedEntry,
          isUpdated: true,
          previousRank: this.entries[existingIndex].rank,
          animationKey: `${updatedEntry.participantId}-${updatedEntry.score}-${updatedEntry.rank}`,
          completedAt: new Date(updatedEntry.completedAt)
        };
      } else {
        // Add new entry
        this.entries.push({
          ...updatedEntry,
          isNew: true,
          animationKey: `${updatedEntry.participantId}-${updatedEntry.score}-${updatedEntry.rank}`,
          completedAt: new Date(updatedEntry.completedAt)
        });
      }

      // Re-sort by rank
      this.entries.sort((a, b) => a.rank - b.rank);
    }

    this.lastUpdateTime = new Date();
    this.renderEntries();

    // Clear animation flags after animation
    setTimeout(() => {
      this.entries = this.entries.map(entry => ({
        ...entry,
        isNew: false,
        isUpdated: false
      }));
      this.renderEntries();
    }, 2000);
  }

  /**
   * Setup WebSocket event listeners
   */
  setupEventListeners() {
    if (this.options.autoRefresh) {
      // Setup real-time updates
      const leaderboardCleanup = WebSocketEventHelper.setupLeaderboardUpdates(
        (data) => this.handleLeaderboardUpdate(data),
        (error) => console.error('Leaderboard update error:', error)
      );
      this.cleanupFunctions.push(leaderboardCleanup);
    }
  }

  /**
   * Load more entries
   */
  async loadMore() {
    if (this.hasMore && !this.isLoading) {
      await this.loadLeaderboard(this.currentPage + 1, true);
    }
  }

  /**
   * Refresh leaderboard
   */
  async refresh() {
    await this.loadLeaderboard(0, false);
  }

  /**
   * Get rank badge information
   */
  getRankBadge(rank) {
    switch (rank) {
      case 1:
        return { emoji: '🥇', class: 'gold', label: 'Birinci' };
      case 2:
        return { emoji: '🥈', class: 'silver', label: 'İkinci' };
      case 3:
        return { emoji: '🥉', class: 'bronze', label: 'Üçüncü' };
      default:
        return { emoji: `#${rank}`, class: 'default', label: `${rank}. sıra` };
    }
  }

  /**
   * Format completion time
   */
  formatCompletionTime(date) {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days} gün önce`;
    } else if (hours > 0) {
      return `${hours} saat önce`;
    } else if (minutes > 0) {
      return `${minutes} dakika önce`;
    } else {
      return 'Az önce';
    }
  }

  /**
   * Render leaderboard component
   */
  render() {
    this.container.innerHTML = `
      <div class="leaderboard">
        <!-- Header -->
        <div class="leaderboard-header">
          <h2 class="leaderboard-title">
            🏆 Liderlik Tablosu
          </h2>
          
          <div class="leaderboard-stats">
            <span class="total-participants">
              <span class="participants-count">0</span> katılımcı
            </span>
            
            <span class="last-update">
              <!-- Last update time will be shown here -->
            </span>
          </div>
        </div>
        
        <!-- Content Area -->
        <div class="leaderboard-content">
          <!-- Entries will be rendered here -->
        </div>
        
        <!-- Actions -->
        <div class="leaderboard-actions">
          <button class="btn btn-outline refresh-btn" onclick="this.refresh()">
            🔄 Yenile
          </button>
          
          <button class="btn btn-outline load-more-btn" style="display: none;">
            📄 Daha Fazla Göster
          </button>
        </div>
      </div>
    `;

    // Bind refresh function
    const refreshBtn = this.container.querySelector('.refresh-btn');
    if (refreshBtn) {
      refreshBtn.onclick = () => this.refresh();
    }

    // Bind load more function
    const loadMoreBtn = this.container.querySelector('.load-more-btn');
    if (loadMoreBtn) {
      loadMoreBtn.onclick = () => this.loadMore();
    }
  }

  /**
   * Update loading state
   */
  updateLoadingState() {
    const contentArea = this.container.querySelector('.leaderboard-content');
    if (!contentArea) return;

    if (this.isLoading && this.entries.length === 0) {
      contentArea.innerHTML = `
        <div class="leaderboard-loading">
          <div class="loading"></div>
          <span>Liderlik tablosu yükleniyor...</span>
        </div>
      `;
    }
  }

  /**
   * Render leaderboard entries
   */
  renderEntries() {
    const contentArea = this.container.querySelector('.leaderboard-content');
    if (!contentArea) return;

    // Update stats
    this.updateStats();

    if (this.entries.length === 0) {
      this.renderEmptyState();
      return;
    }

    const entriesHTML = this.entries.map(entry => {
      const rankBadge = this.getRankBadge(entry.rank);
      const isCurrentUser = this.options.currentUserId === entry.participantId;
      
      return `
        <div class="leaderboard-entry ${isCurrentUser ? 'current-user' : ''} ${
          entry.isNew ? 'new-entry' : ''
        } ${entry.isUpdated ? 'updated-entry' : ''}" data-participant-id="${entry.participantId}">
          
          <!-- Rank -->
          <div class="entry-rank ${rankBadge.class}">
            <span class="rank-badge" aria-label="${rankBadge.label}">
              ${rankBadge.emoji}
            </span>
            
            ${entry.previousRank && entry.previousRank !== entry.rank ? `
              <div class="rank-change">
                ${entry.rank < entry.previousRank ? 
                  `<span class="rank-up" title="Sıralamada yükseldi">↗️ +${entry.previousRank - entry.rank}</span>` :
                  `<span class="rank-down" title="Sıralamada düştü">↘️ -${entry.rank - entry.previousRank}</span>`
                }
              </div>
            ` : ''}
          </div>
          
          <!-- Participant Info -->
          <div class="entry-info">
            <div class="participant-name">
              ${entry.name}
              ${isCurrentUser ? '<span class="current-user-badge">Sen</span>' : ''}
            </div>
            
            <div class="entry-meta">
              <span class="completion-time">
                ${this.formatCompletionTime(entry.completedAt)}
              </span>
              
              ${this.options.showFullStats ? `
                <span class="questions-stats">
                  ${entry.correctAnswers || 0}/${entry.questionsAnswered || 0} doğru
                </span>
                <span class="response-time">
                  Ort. ${(entry.avgResponseTime || 0).toFixed(1)}s
                </span>
              ` : ''}
            </div>
          </div>
          
          <!-- Score -->
          <div class="entry-score">
            <span class="score-value">
              ${entry.score.toLocaleString('tr-TR')}
            </span>
            <span class="score-label">puan</span>
            
            ${entry.isUpdated ? `
              <div class="score-animation">
                <span class="score-plus">+</span>
              </div>
            ` : ''}
          </div>
          
          <!-- New Entry Indicator -->
          ${entry.isNew ? `
            <div class="new-indicator">
              <span class="new-badge">Yeni!</span>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    contentArea.innerHTML = `
      <div class="leaderboard-list" role="list">
        ${entriesHTML}
      </div>
    `;

    // Update load more button
    this.updateLoadMoreButton();
  }

  /**
   * Render empty state
   */
  renderEmptyState() {
    const contentArea = this.container.querySelector('.leaderboard-content');
    if (!contentArea) return;

    contentArea.innerHTML = `
      <div class="leaderboard-empty">
        <div class="empty-content">
          <span class="empty-icon">🏆</span>
          <h3 class="empty-title">Henüz Katılımcı Yok</h3>
          <p class="empty-message">
            İlk yarışmacı olmak için hemen başla!
          </p>
          <a href="/register.html" class="btn btn-primary">
            Yarışmaya Katıl
          </a>
        </div>
      </div>
    `;
  }

  /**
   * Render error state
   */
  renderError() {
    const contentArea = this.container.querySelector('.leaderboard-content');
    if (!contentArea) return;

    contentArea.innerHTML = `
      <div class="leaderboard-error">
        <div class="error-content">
          <span class="error-icon">⚠️</span>
          <h3 class="error-title">Liderlik Tablosu Yüklenemedi</h3>
          <p class="error-message">${this.error}</p>
          <button class="btn btn-primary" onclick="this.refresh()">
            Tekrar Dene
          </button>
        </div>
      </div>
    `;

    // Bind refresh function
    const retryBtn = contentArea.querySelector('.btn');
    if (retryBtn) {
      retryBtn.onclick = () => this.refresh();
    }
  }

  /**
   * Update statistics display
   */
  updateStats() {
    // Update participant count
    const participantCountElement = this.container.querySelector('.participants-count');
    if (participantCountElement) {
      participantCountElement.textContent = this.totalEntries.toLocaleString('tr-TR');
    }

    // Update last update time
    const lastUpdateElement = this.container.querySelector('.last-update');
    if (lastUpdateElement && this.lastUpdateTime) {
      lastUpdateElement.textContent = `Son güncelleme: ${this.formatCompletionTime(this.lastUpdateTime)}`;
    }
  }

  /**
   * Update load more button visibility
   */
  updateLoadMoreButton() {
    const loadMoreBtn = this.container.querySelector('.load-more-btn');
    if (loadMoreBtn) {
      if (this.hasMore) {
        loadMoreBtn.style.display = 'inline-flex';
        loadMoreBtn.disabled = this.isLoading;
        loadMoreBtn.innerHTML = this.isLoading ? 
          '<span class="loading"></span> Yükleniyor...' :
          '📄 Daha Fazla Göster';
      } else {
        loadMoreBtn.style.display = 'none';
      }
    }
  }

  /**
   * Highlight user entry
   */
  highlightUserEntry(participantId) {
    // Remove previous highlights
    this.container.querySelectorAll('.leaderboard-entry').forEach(entry => {
      entry.classList.remove('highlighted');
    });

    // Add highlight to user entry
    const userEntry = this.container.querySelector(`[data-participant-id="${participantId}"]`);
    if (userEntry) {
      userEntry.classList.add('highlighted');
      
      // Scroll to user entry
      userEntry.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center' 
      });

      // Remove highlight after 3 seconds
      setTimeout(() => {
        userEntry.classList.remove('highlighted');
      }, 3000);
    }
  }

  /**
   * Filter entries by search term
   */
  filterEntries(searchTerm) {
    if (!searchTerm || searchTerm.trim() === '') {
      this.renderEntries();
      return;
    }

    const filteredEntries = this.entries.filter(entry => 
      entry.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Render filtered entries
    const contentArea = this.container.querySelector('.leaderboard-content');
    if (!contentArea) return;

    if (filteredEntries.length === 0) {
      contentArea.innerHTML = `
        <div class="leaderboard-empty">
          <div class="empty-content">
            <span class="empty-icon">🔍</span>
            <h3 class="empty-title">Arama Sonucu Bulunamadı</h3>
            <p class="empty-message">
              "${searchTerm}" için sonuç bulunamadı
            </p>
          </div>
        </div>
      `;
      return;
    }

    // Render filtered results (reuse existing render logic)
    const originalEntries = this.entries;
    this.entries = filteredEntries;
    this.renderEntries();
    this.entries = originalEntries;
  }

  /**
   * Get leaderboard statistics
   */
  getStats() {
    return {
      totalEntries: this.totalEntries,
      currentPage: this.currentPage,
      entriesLoaded: this.entries.length,
      hasMore: this.hasMore,
      lastUpdate: this.lastUpdateTime
    };
  }

  /**
   * Cleanup component
   */
  cleanup() {
    // Run cleanup functions
    this.cleanupFunctions.forEach(cleanup => cleanup());
    this.cleanupFunctions = [];

    console.log('Leaderboard component cleaned up');
  }
}

export default Leaderboard;
