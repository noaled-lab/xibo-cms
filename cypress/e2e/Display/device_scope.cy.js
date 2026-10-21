describe('Device resource scope', function() {
  beforeEach(function() {
    cy.login();
    cy.intercept('GET', '/display?*', (request) => {
      if (request.query.length === '100') {
        request.reply({
          recordsTotal: 2,
          data: [
            {displayId: 101, displayGroupId: 201, display: 'Lobby'},
            {displayId: 102, displayGroupId: 202, display: 'Entrance'},
          ],
        });
      }
    }).as('devices');
  });

  it('filters, persists across pages, and clears with All', function() {
    cy.intercept('GET', '/layout?*', (request) => {
      if (request.query.contextDisplayId === '101') {
        request.alias = 'scopedLayouts';
      }
    });
    cy.visit('/layout/view');
    cy.get('#device-scope [data-display-id="101"]').click();
    cy.get('#device-scope [data-display-id="101"]')
      .should('have.attr', 'aria-pressed', 'true');
    cy.wait('@scopedLayouts').its('request.query.contextDisplayId')
      .should('eq', '101');

    cy.visit('/template/view');
    cy.get('#device-scope [data-display-id="101"]')
      .should('have.attr', 'aria-pressed', 'true');
    cy.intercept('GET', '/template?*', (request) => {
      if (!request.query.contextDisplayId) request.alias = 'allTemplates';
    });
    cy.get('#device-scope [data-display-id=""]').click();
    cy.get('#device-scope [data-display-id=""]')
      .should('have.attr', 'aria-pressed', 'true');
    cy.wait('@allTemplates').its('request.query')
      .should('not.have.property', 'contextDisplayId');
  });

  it('does not scope campaigns or media', function() {
    cy.visit('/layout/view');
    cy.get('#device-scope [data-display-id="101"]').click();
    cy.visit('/library/view');
    cy.get('#device-scope').should('be.visible');
    cy.scrollTo('bottom', {ensureScrollable: false});
    cy.get('#device-scope').should(($bar) => {
      expect($bar[0].getBoundingClientRect().top).to.eq(0);
    });
    cy.get('#device-scope').should('have.attr', 'data-filter-enabled', 'false');
    cy.get('#device-scope [data-display-id="102"]').click();
    cy.visit('/campaign/view');
    cy.get('#device-scope').should('be.visible');
    cy.get('#device-scope').should('have.attr', 'data-filter-enabled', 'false');
    cy.visit('/resolution/view');
    cy.get('#device-scope [data-display-id="102"]')
      .should('have.attr', 'aria-pressed', 'true');
  });
});
