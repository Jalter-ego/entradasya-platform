import type { Request, Response } from 'express';
import { ERROR_CODES } from '../constants/constants.js';
import { toSalesReport } from '../mappers/reportMapper.js';
import type { ReportsRepository } from '../repositories/reportsRepository.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { AppError } from '../utils/appError.js';
import { reportParamsSchema } from '../validators/reportValidators.js';

export class ReportsController {
  constructor(private readonly repo: ReportsRepository) {}

  /** Solo el organizador dueño (según la copia de la reserva) ve las ventas; cuenta únicamente órdenes pagadas. */
  eventSales = async (req: Request, res: Response) => {
    const { eventId } = reportParamsSchema.parse(req.params);
    const organizerId = req.user!.id;
    if (await this.repo.belongsToAnotherOrganizer(eventId, organizerId)) {
      throw new AppError(403, ERROR_CODES.FORBIDDEN, 'Solo el organizador del evento puede ver sus ventas');
    }
    const rows = await this.repo.salesBySector(eventId, organizerId);
    ApiResponse.ok(res, 'Reporte de ventas obtenido correctamente', toSalesReport(eventId, rows));
  };
}
