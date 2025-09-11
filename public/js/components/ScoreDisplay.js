/**
 * Score Display Component
 * Shows current score with animations and answer feedback
 */

export class ScoreDisplay {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Score container not found: ${containerId}`);
    }

    this.options = {
      animationDuration: 1000,
      feedbackDuration: 3000,
      showBreakdown: true,
      ...options
    };

    this.currentScore = 0;
    this.animatedScore = 0;
    this.session = null;
    this.lastAnswer = null;
    this.animationFrame = null;
    
    this.render();
  }

  /**
   * Update score display
   */
  updateScore(session, lastAnswer = null) {
    this.session = session;
    
    if (session && session.totalScore !== this.currentScore) {
      this.animateScoreChange(this.currentScore, session.totalScore);
      this.currentScore = session.totalScore;
    }
    
    if (lastAnswer) {
      this.showAnswerFeedback(lastAnswer);
    }
    
    this.updateProgressIndicator();
  }

  /**
   * Show answer feedback
   */
  showAnswerFeedback(answerResult) {
    this.lastAnswer = answerResult;
    
    // Create feedback element
    const feedbackHTML = this.createAnswerFeedbackHTML(answerResult);
    
    // Find or create feedback container
    let feedbackContainer = this.container.querySelector('.answer-feedback');
    if (!feedbackContainer) {
      feedbackContainer = document.createElement('div');
      feedbackContainer.className = 'answer-feedback';
      this.container.appendChild(feedbackContainer);
    }
    
    // Show feedback with animation
    feedbackContainer.innerHTML = feedbackHTML;
    feedbackContainer.classList.add('visible');
    
    // Auto-hide after duration
    setTimeout(() => {
      feedbackContainer.classList.remove('visible');
      setTimeout(() => {
        if (feedbackContainer.parentElement) {
          feedbackContainer.remove();
        }
      }, 300);
    }, this.options.feedbackDuration);
  }

  /**
   * Animate score change
   */
  animateScoreChange(fromScore, toScore) {
    const startTime = Date.now();
    const duration = this.options.animationDuration;
    const difference = toScore - fromScore;

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Easing function (ease-out cubic)
      const easeOut = 1 - Math.pow(1 - progress, 3);
      
      this.animatedScore = Math.round(fromScore + (difference * easeOut));
      this.updateScoreDisplay();
      
      if (progress < 1) {
        this.animationFrame = requestAnimationFrame(animate);
      } else {
        this.animatedScore = toScore;
        this.updateScoreDisplay();
      }
    };

    // Cancel previous animation
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }

    animate();
  }

  /**
   * Update score display elements
   */
  updateScoreDisplay() {
    const scoreElement = this.container.querySelector('.score-number');
    if (scoreElement) {
      scoreElement.textContent = this.animatedScore.toLocaleString('tr-TR');
    }
  }

  /**
   * Update progress indicator
   */
  updateProgressIndicator() {
    if (!this.session) return;

    const questionsAnsweredElement = this.container.querySelector('.questions-answered');
    if (questionsAnsweredElement) {
      questionsAnsweredElement.textContent = 
        `${this.session.questionIndex} / ${this.session.totalQuestions || '?'} soru`;
    }

    const progressFillElement = this.container.querySelector('.progress-fill');
    if (progressFillElement && this.session.totalQuestions) {
      const percentage = (this.session.questionIndex / this.session.totalQuestions) * 100;
      progressFillElement.style.width = `${percentage}%`;
    }
  }

  /**
   * Create answer feedback HTML
   */
  createAnswerFeedbackHTML(answerResult) {
    const isCorrect = answerResult.isCorrect;
    const points = answerResult.earnedPoints;
    const breakdown = answerResult.scoreBreakdown;
    const matchType = answerResult.matchType;
    const similarity = answerResult.similarity;
    const responseTime = answerResult.responseTime;
    const correctAnswer = answerResult.correctAnswer;

    // Match type display
    const matchTypeText = {
      exact: '🎯 Tam Eşleşme',
      fuzzy: '🔍 Benzer Eşleşme',
      partial: '📝 Kısmi Eşleşme',
      none: '❌ Eşleşme Yok'
    }[matchType] || matchType;

    // Breakdown HTML
    let breakdownHTML = '';
    if (this.options.showBreakdown && breakdown) {
      const breakdownItems = [];
      
      if (breakdown.basePts > 0) {
        breakdownItems.push(`<div class="breakdown-item">
          <span class="breakdown-label">Temel Puan:</span>
          <span class="breakdown-value">+${breakdown.basePts}</span>
        </div>`);
      }
      
      if (breakdown.timeBonusPts > 0) {
        breakdownItems.push(`<div class="breakdown-item">
          <span class="breakdown-label">Hız Bonusu:</span>
          <span class="breakdown-value">+${breakdown.timeBonusPts}</span>
        </div>`);
      }
      
      if (breakdown.streakBonusPts > 0) {
        breakdownItems.push(`<div class="breakdown-item">
          <span class="breakdown-label">Seri Bonusu:</span>
          <span class="breakdown-value">+${breakdown.streakBonusPts}</span>
        </div>`);
      }
      
      if (breakdown.difficultyBonusPts > 0) {
        breakdownItems.push(`<div class="breakdown-item">
          <span class="breakdown-label">Zorluk Bonusu:</span>
          <span class="breakdown-value">+${breakdown.difficultyBonusPts}</span>
        </div>`);
      }
      
      if (breakdownItems.length > 0) {
        breakdownHTML = `<div class="score-breakdown">${breakdownItems.join('')}</div>`;
      }
    }

    return `
      <div class="feedback-header ${isCorrect ? 'correct' : 'incorrect'}">
        <span class="feedback-icon">${isCorrect ? '✅' : '❌'}</span>
        <span class="feedback-text">${isCorrect ? 'Doğru!' : 'Yanlış'}</span>
        <span class="feedback-points">+${points} puan</span>
      </div>
      
      ${breakdownHTML}
      
      <div class="feedback-details">
        <div class="match-info">
          <span class="match-type">${matchTypeText}</span>
          ${similarity > 0 ? `
            <span class="similarity">
              %${Math.round(similarity * 100)} benzerlik
            </span>
          ` : ''}
        </div>
        
        <div class="response-time">
          <span class="time-label">Cevap Süresi:</span>
          <span class="time-value">${(responseTime / 1000).toFixed(1)}s</span>
        </div>
        
        ${!isCorrect ? `
          <div class="correct-answer">
            <span class="correct-label">Doğru Cevap:</span>
            <span class="correct-text">${correctAnswer}</span>
          </div>
        ` : ''}
      </div>
    `;
  }

  /**
   * Render score display component
   */
  render() {
    this.container.innerHTML = `
      <div class="score-display">
        <!-- Main Score -->
        <div class="score-main">
          <div class="score-value">
            <span class="score-number">0</span>
            <span class="score-label">Puan</span>
          </div>
          
          <!-- Progress Indicator -->
          <div class="score-progress">
            <div class="progress-info">
              <span class="questions-answered">0 / ? soru</span>
            </div>
            
            <div class="progress-bar">
              <div class="progress-fill" style="width: 0%"></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Cleanup component
   */
  cleanup() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
    
    // Remove any existing feedback
    const feedbackContainer = this.container.querySelector('.answer-feedback');
    if (feedbackContainer) {
      feedbackContainer.remove();
    }
  }
}

export default ScoreDisplay;
