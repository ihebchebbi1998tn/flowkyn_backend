import { Request, Response, NextFunction } from 'express';
import { ContactService } from '../services/contact.service';
import { AuthRequest } from '../types';

const contactService = new ContactService();

export class ContactController {
  /** Public — anyone can submit a contact form */
  async submit(req: Request, res: Response, next: NextFunction) {
    try {
      const { name, email, subject, message } = req.body;
      const ipAddress = req.ip || req.headers['x-forwarded-for']?.toString();
      const submission = await contactService.create({ name, email, subject, message, ipAddress });
      res.status(201).json({ message: 'Message sent successfully', id: submission.id });
    } catch (err) { next(err); }
  }

  /** Admin — list all submissions */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { page = '1', limit = '20', status } = req.query;
      const result = await contactService.list(Number(page), Number(limit), status as string);
      res.json(result);
    } catch (err) { next(err); }
  }

  /** Admin — get single submission */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const submission = await contactService.getById(req.params.id);
      if (!submission) { res.status(404).json({ error: 'Submission not found' }); return; }
      res.json(submission);
    } catch (err) { next(err); }
  }

  /** Admin — update status (new → read → replied → archived) */
  async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { status } = req.body;
      const submission = await contactService.updateStatus(req.params.id, status);
      if (!submission) { res.status(404).json({ error: 'Submission not found' }); return; }
      res.json(submission);
    } catch (err) { next(err); }
  }

  /** Admin — delete submission */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await contactService.delete(req.params.id);
      if (!result) { res.status(404).json({ error: 'Submission not found' }); return; }
      res.status(204).end();
    } catch (err) { next(err); }
  }
}
