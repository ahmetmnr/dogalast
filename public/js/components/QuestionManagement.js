/**
 * Question Management Component
 * CRUD operations and bulk management for quiz questions
 */

import { api } from '../core/ApiClient.ts';

export class QuestionManagement {
  constructor(containerId, adminPermissions) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Question management container not found: ${containerId}`);
    }

    this.adminPermissions = adminPermissions || [];
    this.questions = [];
    this.filteredQuestions = [];
    this.isLoading = true;
    this.error = null;
    this.filters = {
      search: '',
      difficulty: null,
      category: '',
      isActive: null
    };
    
    this.selectedQuestions = new Set();
    this.showCreateModal = false;
    this.editingQuestion = null;
    this.showBulkImport = false;
    
    // Permission checks
    this.canCreate = this.adminPermissions.includes('question_create');
    this.canEdit = this.adminPermissions.includes('question_edit');
    this.canDelete = this.adminPermissions.includes('question_delete');
    this.canBulkImport = this.adminPermissions.includes('question_bulk_import');
    
    this.render();
    this.loadQuestions();
  }

  /**
   * Load questions from API
   */
  async loadQuestions() {
    try {
      this.isLoading = true;
      this.error = null;
      this.updateLoadingState();

      const response = await api.admin.getQuestions();

      if (response.success && response.data) {
        this.questions = response.data.map(q => ({
          ...q,
          createdAt: new Date(q.createdAt),
          updatedAt: new Date(q.updatedAt)
        }));
        this.applyFilters();
      } else {
        throw new Error(response.error?.message || 'Sorular yüklenemedi');
      }

    } catch (error) {
      console.error('Failed to load questions:', error);
      this.error = error.message || 'Sorular yüklenirken hata oluştu';
      this.renderError();
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Apply filters to questions
   */
  applyFilters() {
    let filtered = [...this.questions];

    // Text search
    if (this.filters.search.trim()) {
      const searchTerm = this.filters.search.toLowerCase();
      filtered = filtered.filter(q => 
        q.text.toLowerCase().includes(searchTerm) ||
        q.correctAnswer.toLowerCase().includes(searchTerm) ||
        q.category.toLowerCase().includes(searchTerm)
      );
    }

    // Difficulty filter
    if (this.filters.difficulty !== null) {
      filtered = filtered.filter(q => q.difficulty === this.filters.difficulty);
    }

    // Category filter
    if (this.filters.category) {
      filtered = filtered.filter(q => q.category === this.filters.category);
    }

    // Active status filter
    if (this.filters.isActive !== null) {
      filtered = filtered.filter(q => q.isActive === this.filters.isActive);
    }

    this.filteredQuestions = filtered;
    this.renderQuestions();
  }

  /**
   * Handle question creation
   */
  async handleCreateQuestion(questionData) {
    try {
      const response = await api.admin.createQuestion(questionData);

      if (response.success && response.data) {
        this.questions = [response.data, ...this.questions];
        this.applyFilters();
        this.showCreateModal = false;
        this.showAlert('Soru başarıyla oluşturuldu', 'success');
      } else {
        throw new Error(response.error?.message || 'Soru oluşturulamadı');
      }

    } catch (error) {
      console.error('Failed to create question:', error);
      this.showAlert(`Soru oluşturma hatası: ${error.message}`, 'error');
    }
  }

  /**
   * Handle question update
   */
  async handleUpdateQuestion(questionId, updates) {
    try {
      const response = await api.admin.updateQuestion(questionId, updates);

      if (response.success && response.data) {
        this.questions = this.questions.map(q => 
          q.id === questionId ? response.data : q
        );
        this.applyFilters();
        this.editingQuestion = null;
        this.showAlert('Soru başarıyla güncellendi', 'success');
      } else {
        throw new Error(response.error?.message || 'Soru güncellenemedi');
      }

    } catch (error) {
      console.error('Failed to update question:', error);
      this.showAlert(`Soru güncelleme hatası: ${error.message}`, 'error');
    }
  }

  /**
   * Handle question deletion
   */
  async handleDeleteQuestion(questionId) {
    if (!confirm('Bu soruyu silmek istediğinizden emin misiniz?')) {
      return;
    }

    try {
      const response = await api.admin.deleteQuestion(questionId);

      if (response.success) {
        this.questions = this.questions.filter(q => q.id !== questionId);
        this.selectedQuestions.delete(questionId);
        this.applyFilters();
        this.showAlert('Soru başarıyla silindi', 'success');
      } else {
        throw new Error(response.error?.message || 'Soru silinemedi');
      }

    } catch (error) {
      console.error('Failed to delete question:', error);
      this.showAlert(`Soru silme hatası: ${error.message}`, 'error');
    }
  }

  /**
   * Handle bulk operations
   */
  async handleBulkDelete() {
    if (this.selectedQuestions.size === 0) return;

    if (!confirm(`${this.selectedQuestions.size} soruyu silmek istediğinizden emin misiniz?`)) {
      return;
    }

    try {
      const questionIds = Array.from(this.selectedQuestions);
      const response = await api.admin.bulkDeleteQuestions(questionIds);

      if (response.success) {
        this.questions = this.questions.filter(q => !this.selectedQuestions.has(q.id));
        this.selectedQuestions.clear();
        this.applyFilters();
        this.showAlert('Sorular başarıyla silindi', 'success');
      } else {
        throw new Error(response.error?.message || 'Toplu silme işlemi başarısız');
      }

    } catch (error) {
      console.error('Failed to bulk delete questions:', error);
      this.showAlert(`Toplu silme hatası: ${error.message}`, 'error');
    }
  }

  /**
   * Handle bulk status update
   */
  async handleBulkStatusUpdate(isActive) {
    if (this.selectedQuestions.size === 0) return;

    try {
      const questionIds = Array.from(this.selectedQuestions);
      const response = await api.admin.bulkUpdateQuestionStatus(questionIds, isActive);

      if (response.success) {
        this.questions = this.questions.map(q => 
          this.selectedQuestions.has(q.id) ? { ...q, isActive } : q
        );
        this.selectedQuestions.clear();
        this.applyFilters();
        this.showAlert('Sorular başarıyla güncellendi', 'success');
      } else {
        throw new Error(response.error?.message || 'Toplu güncelleme başarısız');
      }

    } catch (error) {
      console.error('Failed to bulk update status:', error);
      this.showAlert(`Toplu güncelleme hatası: ${error.message}`, 'error');
    }
  }

  /**
   * Handle selection
   */
  handleSelectQuestion(questionId, selected) {
    if (selected) {
      this.selectedQuestions.add(questionId);
    } else {
      this.selectedQuestions.delete(questionId);
    }
    this.updateBulkActions();
  }

  handleSelectAll(selected) {
    if (selected) {
      this.selectedQuestions = new Set(this.filteredQuestions.map(q => q.id));
    } else {
      this.selectedQuestions.clear();
    }
    this.renderQuestions();
  }

  /**
   * Show alert message
   */
  showAlert(message, type = 'info') {
    const alertContainer = this.container.querySelector('.alert-container');
    if (!alertContainer) return;

    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.innerHTML = `
      <span class="alert-icon">
        ${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}
      </span>
      <span class="alert-message">${message}</span>
      <button class="alert-close" onclick="this.parentElement.remove()">✕</button>
    `;

    alertContainer.appendChild(alert);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (alert.parentElement) {
        alert.remove();
      }
    }, 5000);
  }

  /**
   * Get unique categories
   */
  getCategories() {
    return Array.from(new Set(this.questions.map(q => q.category))).sort();
  }

  /**
   * Render question management component
   */
  render() {
    this.container.innerHTML = `
      <div class="question-management">
        <!-- Alert Container -->
        <div class="alert-container"></div>
        
        <!-- Header -->
        <div class="management-header">
          <div class="header-content">
            <h1 class="page-title">❓ Soru Yönetimi</h1>
            <p class="page-description">
              Quiz sorularını yönetin, düzenleyin ve analiz edin
            </p>
          </div>
          
          <div class="header-actions">
            ${this.canCreate ? `
              <button class="btn btn-primary create-btn">
                <span>➕</span>
                <span>Yeni Soru</span>
              </button>
            ` : ''}
            
            ${this.canBulkImport ? `
              <button class="btn btn-outline import-btn">
                <span>📁</span>
                <span>Toplu İçe Aktar</span>
              </button>
            ` : ''}
            
            <button class="btn btn-outline refresh-btn">
              <span class="refresh-icon">↻</span>
              <span>Yenile</span>
            </button>
          </div>
        </div>
        
        <!-- Filters -->
        <div class="management-filters">
          <div class="filter-group">
            <input
              type="text"
              class="filter-input search-input"
              placeholder="Soru metni, cevap veya kategori ara..."
              value="${this.filters.search}"
            />
          </div>
          
          <div class="filter-group">
            <select class="filter-select difficulty-filter">
              <option value="">Tüm Zorluklar</option>
              <option value="1" ${this.filters.difficulty === 1 ? 'selected' : ''}>⭐ Çok Kolay</option>
              <option value="2" ${this.filters.difficulty === 2 ? 'selected' : ''}>⭐⭐ Kolay</option>
              <option value="3" ${this.filters.difficulty === 3 ? 'selected' : ''}>⭐⭐⭐ Orta</option>
              <option value="4" ${this.filters.difficulty === 4 ? 'selected' : ''}>⭐⭐⭐⭐ Zor</option>
              <option value="5" ${this.filters.difficulty === 5 ? 'selected' : ''}>⭐⭐⭐⭐⭐ Çok Zor</option>
            </select>
          </div>
          
          <div class="filter-group">
            <select class="filter-select category-filter">
              <option value="">Tüm Kategoriler</option>
              <!-- Categories will be populated dynamically -->
            </select>
          </div>
          
          <div class="filter-group">
            <select class="filter-select status-filter">
              <option value="">Tüm Durumlar</option>
              <option value="true" ${this.filters.isActive === true ? 'selected' : ''}>✅ Aktif</option>
              <option value="false" ${this.filters.isActive === false ? 'selected' : ''}>❌ Pasif</option>
            </select>
          </div>
        </div>
        
        <!-- Bulk Actions -->
        <div class="bulk-actions" style="display: none;">
          <div class="bulk-info">
            <span class="selection-count">0 soru seçildi</span>
          </div>
          
          <div class="bulk-buttons">
            <button class="btn btn-outline activate-btn">
              ✅ Aktifleştir
            </button>
            
            <button class="btn btn-outline deactivate-btn">
              ❌ Pasifleştir
            </button>
            
            ${this.canDelete ? `
              <button class="btn btn-outline danger bulk-delete-btn">
                🗑️ Sil
              </button>
            ` : ''}
          </div>
        </div>
        
        <!-- Questions Content -->
        <div class="questions-content">
          <!-- Content will be rendered here -->
        </div>
        
        <!-- Statistics -->
        <div class="questions-stats">
          <div class="stat-item">
            <span class="stat-label">Toplam Soru:</span>
            <span class="stat-value total-questions">0</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Aktif Soru:</span>
            <span class="stat-value active-questions">0</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Filtrelenen:</span>
            <span class="stat-value filtered-questions">0</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Seçilen:</span>
            <span class="stat-value selected-questions">0</span>
          </div>
        </div>
      </div>
    `;

    this.bindEventHandlers();
    this.updateCategoryFilter();
  }

  /**
   * Bind event handlers
   */
  bindEventHandlers() {
    // Refresh button
    const refreshBtn = this.container.querySelector('.refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.loadQuestions());
    }

    // Create button
    const createBtn = this.container.querySelector('.create-btn');
    if (createBtn) {
      createBtn.addEventListener('click', () => this.showCreateQuestionModal());
    }

    // Import button
    const importBtn = this.container.querySelector('.import-btn');
    if (importBtn) {
      importBtn.addEventListener('click', () => this.showBulkImportModal());
    }

    // Filter inputs
    const searchInput = this.container.querySelector('.search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.filters.search = e.target.value;
        this.applyFilters();
      });
    }

    const difficultyFilter = this.container.querySelector('.difficulty-filter');
    if (difficultyFilter) {
      difficultyFilter.addEventListener('change', (e) => {
        this.filters.difficulty = e.target.value ? parseInt(e.target.value) : null;
        this.applyFilters();
      });
    }

    const categoryFilter = this.container.querySelector('.category-filter');
    if (categoryFilter) {
      categoryFilter.addEventListener('change', (e) => {
        this.filters.category = e.target.value;
        this.applyFilters();
      });
    }

    const statusFilter = this.container.querySelector('.status-filter');
    if (statusFilter) {
      statusFilter.addEventListener('change', (e) => {
        this.filters.isActive = e.target.value === '' ? null : e.target.value === 'true';
        this.applyFilters();
      });
    }

    // Bulk action buttons
    const activateBtn = this.container.querySelector('.activate-btn');
    if (activateBtn) {
      activateBtn.addEventListener('click', () => this.handleBulkStatusUpdate(true));
    }

    const deactivateBtn = this.container.querySelector('.deactivate-btn');
    if (deactivateBtn) {
      deactivateBtn.addEventListener('click', () => this.handleBulkStatusUpdate(false));
    }

    const bulkDeleteBtn = this.container.querySelector('.bulk-delete-btn');
    if (bulkDeleteBtn) {
      bulkDeleteBtn.addEventListener('click', () => this.handleBulkDelete());
    }
  }

  /**
   * Update loading state
   */
  updateLoadingState() {
    const contentArea = this.container.querySelector('.questions-content');
    if (!contentArea) return;

    if (this.isLoading && this.questions.length === 0) {
      contentArea.innerHTML = `
        <div class="table-loading">
          <div class="loading"></div>
          <span>Sorular yükleniyor...</span>
        </div>
      `;
    }
  }

  /**
   * Update category filter options
   */
  updateCategoryFilter() {
    const categoryFilter = this.container.querySelector('.category-filter');
    if (!categoryFilter) return;

    const categories = this.getCategories();
    const currentValue = categoryFilter.value;

    // Clear existing options except the first one
    categoryFilter.innerHTML = '<option value="">Tüm Kategoriler</option>';

    // Add category options
    categories.forEach(category => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      if (category === currentValue) {
        option.selected = true;
      }
      categoryFilter.appendChild(option);
    });
  }

  /**
   * Render questions table
   */
  renderQuestions() {
    const contentArea = this.container.querySelector('.questions-content');
    if (!contentArea) return;

    if (this.isLoading) {
      this.updateLoadingState();
      return;
    }

    if (this.filteredQuestions.length === 0) {
      this.renderEmptyState();
      return;
    }

    contentArea.innerHTML = `
      <div class="questions-table-container">
        <table class="questions-table">
          <thead>
            <tr>
              <th class="select-column">
                <input
                  type="checkbox"
                  class="select-all-checkbox"
                  ${this.selectedQuestions.size === this.filteredQuestions.length && this.filteredQuestions.length > 0 ? 'checked' : ''}
                />
              </th>
              <th>Soru</th>
              <th>Kategori</th>
              <th>Zorluk</th>
              <th>Puan</th>
              <th>Durum</th>
              <th>Oluşturan</th>
              <th>Güncelleme</th>
              <th class="actions-column">İşlemler</th>
            </tr>
          </thead>
          <tbody>
            ${this.filteredQuestions.map(question => this.renderQuestionRow(question)).join('')}
          </tbody>
        </table>
      </div>
    `;

    this.bindTableEventHandlers();
    this.updateStats();
    this.updateBulkActions();
  }

  /**
   * Render single question row
   */
  renderQuestionRow(question) {
    const isSelected = this.selectedQuestions.has(question.id);
    
    return `
      <tr class="${isSelected ? 'selected' : ''}" data-question-id="${question.id}">
        <td>
          <input
            type="checkbox"
            class="question-checkbox"
            ${isSelected ? 'checked' : ''}
            data-question-id="${question.id}"
          />
        </td>
        
        <td class="question-text">
          <div class="text-preview">
            ${question.text.length > 100 
              ? `${question.text.substring(0, 100)}...` 
              : question.text
            }
          </div>
          ${question.options ? `
            <div class="options-count">
              ${question.options.length} seçenek
            </div>
          ` : ''}
        </td>
        
        <td>
          <span class="category-badge">${question.category}</span>
        </td>
        
        <td>
          <div class="difficulty-stars">
            ${Array.from({ length: 5 }, (_, i) => 
              `<span class="${i < question.difficulty ? 'filled' : 'empty'}">⭐</span>`
            ).join('')}
          </div>
        </td>
        
        <td>
          <span class="points-value">${question.basePoints}</span>
        </td>
        
        <td>
          <span class="status-badge ${question.isActive ? 'active' : 'inactive'}">
            ${question.isActive ? '✅ Aktif' : '❌ Pasif'}
          </span>
        </td>
        
        <td>
          <div class="creator-info">
            <span class="creator-name">${question.createdBy}</span>
            <span class="creation-date">
              ${question.createdAt.toLocaleDateString('tr-TR')}
            </span>
          </div>
        </td>
        
        <td>
          <div class="update-info">
            <span class="updater-name">${question.updatedBy}</span>
            <span class="update-date">
              ${question.updatedAt.toLocaleDateString('tr-TR')}
            </span>
          </div>
        </td>
        
        <td>
          <div class="action-buttons">
            <button
              class="btn-icon view"
              title="Görüntüle"
              data-action="view"
              data-question-id="${question.id}"
            >
              👁️
            </button>
            
            ${this.canEdit ? `
              <button
                class="btn-icon edit"
                title="Düzenle"
                data-action="edit"
                data-question-id="${question.id}"
              >
                ✏️
              </button>
            ` : ''}
            
            ${this.canDelete ? `
              <button
                class="btn-icon delete"
                title="Sil"
                data-action="delete"
                data-question-id="${question.id}"
              >
                🗑️
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }

  /**
   * Bind table event handlers
   */
  bindTableEventHandlers() {
    // Select all checkbox
    const selectAllCheckbox = this.container.querySelector('.select-all-checkbox');
    if (selectAllCheckbox) {
      selectAllCheckbox.addEventListener('change', (e) => {
        this.handleSelectAll(e.target.checked);
      });
    }

    // Individual checkboxes
    const questionCheckboxes = this.container.querySelectorAll('.question-checkbox');
    questionCheckboxes.forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const questionId = e.target.getAttribute('data-question-id');
        this.handleSelectQuestion(questionId, e.target.checked);
      });
    });

    // Action buttons
    const actionButtons = this.container.querySelectorAll('.btn-icon');
    actionButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        const action = e.target.getAttribute('data-action');
        const questionId = e.target.getAttribute('data-question-id');
        this.handleQuestionAction(action, questionId);
      });
    });
  }

  /**
   * Handle question action
   */
  handleQuestionAction(action, questionId) {
    const question = this.questions.find(q => q.id === questionId);
    if (!question) return;

    switch (action) {
      case 'view':
        this.showQuestionViewModal(question);
        break;
      case 'edit':
        this.showQuestionEditModal(question);
        break;
      case 'delete':
        this.handleDeleteQuestion(questionId);
        break;
    }
  }

  /**
   * Show question view modal
   */
  showQuestionViewModal(question) {
    // Implementation for view modal
    console.log('Show question view modal:', question);
  }

  /**
   * Show question edit modal
   */
  showQuestionEditModal(question) {
    // Implementation for edit modal
    console.log('Show question edit modal:', question);
  }

  /**
   * Show create question modal
   */
  showCreateQuestionModal() {
    // Implementation for create modal
    console.log('Show create question modal');
  }

  /**
   * Show bulk import modal
   */
  showBulkImportModal() {
    // Implementation for bulk import modal
    console.log('Show bulk import modal');
  }

  /**
   * Render empty state
   */
  renderEmptyState() {
    const contentArea = this.container.querySelector('.questions-content');
    if (!contentArea) return;

    const hasFilters = this.filters.search || this.filters.difficulty || 
                      this.filters.category || this.filters.isActive !== null;

    contentArea.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">❓</span>
        <h3>Soru Bulunamadı</h3>
        <p>
          ${hasFilters
            ? 'Filtrelere uygun soru bulunamadı. Filtreleri temizleyip tekrar deneyin.'
            : 'Henüz hiç soru eklenmemiş. İlk soruyu eklemek için "Yeni Soru" butonunu kullanın.'
          }
        </p>
      </div>
    `;
  }

  /**
   * Render error state
   */
  renderError() {
    const contentArea = this.container.querySelector('.questions-content');
    if (!contentArea) return;

    contentArea.innerHTML = `
      <div class="error-state">
        <span class="error-icon">⚠️</span>
        <h3>Soru Yönetimi Yüklenemedi</h3>
        <p>${this.error}</p>
        <button class="btn btn-primary retry-btn">
          Tekrar Dene
        </button>
      </div>
    `;

    const retryBtn = contentArea.querySelector('.retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => this.loadQuestions());
    }
  }

  /**
   * Update bulk actions visibility
   */
  updateBulkActions() {
    const bulkActions = this.container.querySelector('.bulk-actions');
    const selectionCount = this.container.querySelector('.selection-count');
    
    if (bulkActions && selectionCount) {
      if (this.selectedQuestions.size > 0) {
        bulkActions.style.display = 'flex';
        selectionCount.textContent = `${this.selectedQuestions.size} soru seçildi`;
      } else {
        bulkActions.style.display = 'none';
      }
    }
  }

  /**
   * Update statistics
   */
  updateStats() {
    const totalQuestionsElement = this.container.querySelector('.total-questions');
    const activeQuestionsElement = this.container.querySelector('.active-questions');
    const filteredQuestionsElement = this.container.querySelector('.filtered-questions');
    const selectedQuestionsElement = this.container.querySelector('.selected-questions');

    if (totalQuestionsElement) {
      totalQuestionsElement.textContent = this.questions.length;
    }

    if (activeQuestionsElement) {
      activeQuestionsElement.textContent = this.questions.filter(q => q.isActive).length;
    }

    if (filteredQuestionsElement) {
      filteredQuestionsElement.textContent = this.filteredQuestions.length;
    }

    if (selectedQuestionsElement) {
      selectedQuestionsElement.textContent = this.selectedQuestions.size;
    }
  }

  /**
   * Get questions statistics
   */
  getStats() {
    return {
      total: this.questions.length,
      active: this.questions.filter(q => q.isActive).length,
      filtered: this.filteredQuestions.length,
      selected: this.selectedQuestions.size
    };
  }

  /**
   * Refresh questions
   */
  async refresh() {
    await this.loadQuestions();
  }

  /**
   * Cleanup component
   */
  cleanup() {
    console.log('Question management cleaned up');
  }
}

export default QuestionManagement;
