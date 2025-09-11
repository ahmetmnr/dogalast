/**
 * Question Display Component
 * Displays quiz questions with animations and accessibility features
 */

export class QuestionDisplay {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Container element not found: ${containerId}`);
    }
    
    this.currentQuestion = null;
    this.session = null;
    this.isVisible = false;
    this.animationDuration = 300;
  }

  /**
   * Update question display
   */
  update(question, session) {
    this.currentQuestion = question;
    this.session = session;
    
    if (question) {
      this.animateQuestionChange();
    } else {
      this.showEmpty();
    }
  }

  /**
   * Show loading state
   */
  showLoading(message = 'Soru hazırlanıyor...') {
    this.container.innerHTML = `
      <div class="question-card">
        <div class="question-loading">
          <div class="loading"></div>
          <p class="text-secondary">${message}</p>
        </div>
      </div>
    `;
  }

  /**
   * Show empty state
   */
  showEmpty() {
    this.container.innerHTML = `
      <div class="question-card">
        <div class="question-empty">
          <p class="text-secondary">Soru bulunamadı</p>
        </div>
      </div>
    `;
  }

  /**
   * Animate question change
   */
  async animateQuestionChange() {
    // Fade out current question
    this.container.style.opacity = '0';
    this.container.style.transform = 'translateY(-20px)';
    
    // Wait for fade out
    await new Promise(resolve => setTimeout(resolve, this.animationDuration));
    
    // Render new question
    this.renderQuestion();
    
    // Fade in new question
    this.container.style.opacity = '1';
    this.container.style.transform = 'translateY(0)';
  }

  /**
   * Render question content
   */
  renderQuestion() {
    if (!this.currentQuestion || !this.session) {
      this.showEmpty();
      return;
    }

    const question = this.currentQuestion;
    const session = this.session;

    // Generate difficulty stars
    const difficultyStars = Array.from({ length: 5 }, (_, i) => 
      `<span class="star ${i < question.difficulty ? 'filled' : 'empty'}">★</span>`
    ).join('');

    // Generate options if available
    let optionsHTML = '';
    if (question.options && question.options.length > 0) {
      optionsHTML = `
        <div class="question-options" role="list" aria-labelledby="current-question">
          ${question.options.map((option, index) => `
            <div class="option-item" role="listitem">
              <span class="option-letter">${String.fromCharCode(65 + index)})</span>
              <span class="option-text">${option}</span>
            </div>
          `).join('')}
        </div>
      `;
    }

    this.container.innerHTML = `
      <div class="question-card visible">
        <!-- Question Header -->
        <div class="question-header">
          <div class="question-meta">
            <span class="question-number">
              Soru ${session.questionIndex + 1}
              ${session.totalQuestions ? ` / ${session.totalQuestions}` : ''}
            </span>
            <div class="difficulty-indicator">
              <span class="difficulty-label">Zorluk:</span>
              <div class="difficulty-stars" aria-label="${question.difficulty} yıldız zorluk">
                ${difficultyStars}
              </div>
            </div>
          </div>
          
          <div class="question-points">
            <span class="points-label">Puan:</span>
            <span class="points-value">${question.basePoints}</span>
          </div>
        </div>
        
        <!-- Question Text -->
        <div class="question-content">
          <h2 class="question-text" id="current-question">
            ${question.text}
          </h2>
          
          ${optionsHTML}
        </div>
        
        <!-- Question Footer -->
        <div class="question-footer">
          <div class="time-limit">
            <span class="time-label">Süre Limiti:</span>
            <span class="time-value">${question.timeLimit} saniye</span>
          </div>
          
          <div class="question-instructions">
            <p class="instruction-text">
              🎤 Mikrofonunuza cevabınızı söyleyin veya soru hakkında bilgi isteyin
            </p>
          </div>
        </div>
      </div>
    `;

    // Add transition styles
    this.container.style.transition = `opacity ${this.animationDuration}ms ease-in-out, transform ${this.animationDuration}ms ease-in-out`;
  }

  /**
   * Highlight correct answer (after submission)
   */
  highlightCorrectAnswer(correctAnswer) {
    const options = this.container.querySelectorAll('.option-item');
    
    options.forEach(option => {
      const optionText = option.querySelector('.option-text');
      if (optionText && optionText.textContent.trim() === correctAnswer.trim()) {
        option.classList.add('correct-answer');
      }
    });
  }

  /**
   * Get current question data
   */
  getCurrentQuestion() {
    return this.currentQuestion;
  }

  /**
   * Check if question is visible
   */
  isQuestionVisible() {
    return this.isVisible;
  }
}

