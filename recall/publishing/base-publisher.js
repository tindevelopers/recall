/**
 * BasePublisher defines the interface for all publishers.
 * Publishers should extend this class and implement:
 *  - validateConfig(config)
 *  - transformData(meetingSummary)
 *  - send(payload)
 */
export class BasePublisher {
  constructor({ name }) {
    this.name = name || "publisher";
  }

  /**
   * Execute the publishing flow with standardized error handling.
   */
  async publish({ meetingSummary, target, integration }) {
    if (!meetingSummary) {
      throw new Error(`[${this.name}] Missing meeting summary`);
    }
    if (!target) {
      throw new Error(`[${this.name}] Missing publish target`);
    }
    if (!integration) {
      throw new Error(`[${this.name}] Missing integration`);
    }

    // Validate configuration
    this.validateConfig(target.config || {});

    // Transform data to publisher-specific payload
    const payload = await this.transformData(meetingSummary, target);

    // Send to external API
    const result = await this.send({
      payload,
      meetingSummary,
      target,
      integration,
    });

    return result || {};
  }

  /**
   * Validate publisher-specific configuration.
   * Must throw on invalid configuration.
   */
  validateConfig(_config) {
    throw new Error(`[${this.name}] validateConfig not implemented`);
  }

  /**
   * Transform meeting data into publisher-specific payload.
   */
  async transformData(_meetingSummary, _target) {
    throw new Error(`[${this.name}] transformData not implemented`);
  }

  /**
   * Send payload to external API.
   */
  async send(_params) {
    throw new Error(`[${this.name}] send not implemented`);
  }
}


